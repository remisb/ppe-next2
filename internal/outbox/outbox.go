// Package outbox is the platform's queue of jobs (ADR 0008 decision 9,
// docs/specs/outbox-service.md): work that must happen because of a change
// but not inside its request. A job is written in the change's transaction
// (Insert), so it exists exactly when the change committed; the worker
// (`api -worker`, Runner) claims due jobs with FOR UPDATE SKIP LOCKED under a
// lease, retries with back-off, and fails a job for good after its attempts.
// Jobs run at least once: handlers are idempotent.
package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Channel is what Insert notifies and the worker listens on.
const Channel = "outbox"

// Job is one piece of work.
type Job struct {
	ID          uuid.UUID       `json:"id"`
	Kind        string          `json:"kind"`
	Key         string          `json:"key"`
	Payload     json.RawMessage `json:"payload"`
	State       string          `json:"state"`
	Attempts    int             `json:"attempts"`
	MaxAttempts int             `json:"max_attempts"`
	RunAfter    time.Time       `json:"run_after"`
	LastError   string          `json:"last_error,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
	FinishedAt  *time.Time      `json:"finished_at,omitempty"`
}

// Execer is satisfied by pgx.Tx and *pgxpool.Pool.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Insert writes a job of kind about key with payload (ids only), due now,
// in db's transaction; a live job of the same kind and key makes it nothing.
// The worker is woken once the transaction commits.
func Insert(ctx context.Context, db Execer, kind, key string, payload any, now time.Time) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO outbox.jobs (id, kind, key, payload, state, run_after, created_at)
		VALUES ($1, $2, $3, $4, 'pending', $5, $5)
		ON CONFLICT (kind, key) WHERE state IN ('pending', 'running') DO NOTHING`,
		uuid.New(), kind, key, raw, now); err != nil {
		return fmt.Errorf("outbox: %w", err)
	}
	_, err = db.Exec(ctx, `SELECT pg_notify($1, $2)`, Channel, kind)
	return err
}

// permanent marks an error that retrying will not mend.
type permanent struct{ err error }

func (p permanent) Error() string { return p.err.Error() }
func (p permanent) Unwrap() error { return p.err }

// Permanent wraps err so the job fails at once instead of being retried:
// a file that is not what it says, a version that is gone.
func Permanent(err error) error { return permanent{err} }

// IsPermanent reports whether err is Permanent's.
func IsPermanent(err error) bool {
	var p permanent
	return errors.As(err, &p)
}

// Backoff is how long a job waits after its nth failed attempt: 30 s, doubling, at most an hour.
func Backoff(attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	d := 30 * time.Second * time.Duration(math.Pow(2, float64(attempts-1)))
	if d > time.Hour || d <= 0 {
		return time.Hour
	}
	return d
}

// Queue is the jobs as the worker and System see them.
type Queue struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

// NewQueue is the queue over pool.
func NewQueue(pool *pgxpool.Pool) *Queue {
	return &Queue{pool: pool, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }}
}

// WithClock sets the queue's clock (tests).
func (q *Queue) WithClock(now func() time.Time) *Queue {
	q.now = now
	return q
}

// Enqueue writes a job outside a transaction, for an after-commit hook (best effort).
func (q *Queue) Enqueue(ctx context.Context, kind, key string, payload any) error {
	return Insert(ctx, q.pool, kind, key, payload, q.now())
}

const jobColumns = `id, kind, key, payload, state, attempts, max_attempts, run_after, coalesce(last_error, ''), created_at, finished_at`

func scanJob(row pgx.Row) (Job, error) {
	var j Job
	err := row.Scan(&j.ID, &j.Kind, &j.Key, &j.Payload, &j.State, &j.Attempts, &j.MaxAttempts, &j.RunAfter, &j.LastError, &j.CreatedAt, &j.FinishedAt)
	return j, err
}

// Claim takes the oldest due job of kinds for worker, under a lease: a
// pending one whose time has come, or a running one whose lease ran out
// (its worker died). Two workers never take one job. False: none is due.
func (q *Queue) Claim(ctx context.Context, worker string, kinds []string, lease time.Duration) (Job, bool, error) {
	now := q.now()
	j, err := scanJob(q.pool.QueryRow(ctx, `
		UPDATE outbox.jobs SET state = 'running', attempts = attempts + 1, lease_until = $1::timestamptz + make_interval(secs => $2::double precision), worker = $3
		WHERE id = (
			SELECT id FROM outbox.jobs
			WHERE kind = ANY($4) AND ((state = 'pending' AND run_after <= $1) OR (state = 'running' AND lease_until < $1))
			ORDER BY run_after, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
		RETURNING `+jobColumns, now, lease.Seconds(), worker, kinds))
	if errors.Is(err, pgx.ErrNoRows) {
		return Job{}, false, nil
	}
	if err != nil {
		return Job{}, false, err
	}
	return j, true, nil
}

// ErrLeaseLost is Done's or Fail's when the job is no longer this claim's:
// its lease ran out and another worker took it.
var ErrLeaseLost = errors.New("outbox: lease lost")

// mine is the condition that the job is still the claim j: running, at the
// attempt it was claimed at (the attempt count fences a later claim off).
const mine = ` AND state = 'running' AND attempts = $2`

func leased(tag pgconn.CommandTag, err error) error {
	if err == nil && tag.RowsAffected() == 0 {
		return ErrLeaseLost
	}
	return err
}

// Done marks a claimed job finished.
func (q *Queue) Done(ctx context.Context, j Job) error {
	return leased(q.pool.Exec(ctx, `UPDATE outbox.jobs SET state = 'done', lease_until = NULL, last_error = NULL, finished_at = $3 WHERE id = $1`+mine,
		j.ID, j.Attempts, q.now()))
}

// Fail records a failed attempt: retried after Backoff, or failed for good
// once its attempts are spent or the error is Permanent. Only a code and a
// short message are kept, never text from a file.
func (q *Queue) Fail(ctx context.Context, j Job, cause error) error {
	msg := strings.ToValidUTF8(cause.Error(), "")
	if len(msg) > 500 {
		msg = strings.ToValidUTF8(msg[:500], "")
	}
	now := q.now()
	if IsPermanent(cause) || j.Attempts >= j.MaxAttempts {
		return leased(q.pool.Exec(ctx, `UPDATE outbox.jobs SET state = 'failed', lease_until = NULL, last_error = $3, finished_at = $4 WHERE id = $1`+mine,
			j.ID, j.Attempts, msg, now))
	}
	return leased(q.pool.Exec(ctx, `UPDATE outbox.jobs SET state = 'pending', lease_until = NULL, last_error = $3, run_after = $4 WHERE id = $1`+mine,
		j.ID, j.Attempts, msg, now.Add(Backoff(j.Attempts))))
}

// Release gives a claimed job back unrun, its attempt not counted: the
// worker is stopping.
func (q *Queue) Release(ctx context.Context, j Job) error {
	return leased(q.pool.Exec(ctx, `UPDATE outbox.jobs SET state = 'pending', attempts = attempts - 1, lease_until = NULL, worker = NULL
		WHERE id = $1`+mine, j.ID, j.Attempts))
}

// Retry makes failed jobs of kind about key due again (Read Again, after a fix).
func (q *Queue) Retry(ctx context.Context, kind, key string, payload any) error {
	return q.Enqueue(ctx, kind, key, payload)
}

// Worker is a worker's heartbeat: what it can run.
type Worker struct {
	Name      string            `json:"name"`
	Version   string            `json:"version"`
	Tools     map[string]string `json:"tools"`
	Kinds     []string          `json:"kinds"`
	StartedAt time.Time         `json:"started_at"`
	SeenAt    time.Time         `json:"seen_at"`
	// Alive is Status's: it beat within the last 2 minutes.
	Alive bool `json:"alive"`
}

// Heartbeat records that w is alive now.
func (q *Queue) Heartbeat(ctx context.Context, w Worker) error {
	tools, err := json.Marshal(w.Tools)
	if err != nil {
		return err
	}
	_, err = q.pool.Exec(ctx, `
		INSERT INTO outbox.workers (name, version, tools, kinds, started_at, seen_at) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (name) DO UPDATE SET version = $2, tools = $3, kinds = $4, started_at = $5, seen_at = $6`,
		w.Name, w.Version, tools, w.Kinds, w.StartedAt, q.now())
	return err
}

// Purge deletes done jobs older than 7 days and failed ones older than 90
// (the owner's function), and workers not seen for 7 days (a container
// replaced by a deploy has another name).
func (q *Queue) Purge(ctx context.Context) (int64, error) {
	now := q.now()
	var n int64
	if err := q.pool.QueryRow(ctx, `SELECT outbox.purge_jobs($1, $2)`, now.Add(-7*24*time.Hour), now.Add(-90*24*time.Hour)).Scan(&n); err != nil {
		return 0, err
	}
	_, err := q.pool.Exec(ctx, `DELETE FROM outbox.workers WHERE seen_at < $1`, now.Add(-7*24*time.Hour))
	return n, err
}

// KindCount is how many jobs of a kind are in each state.
type KindCount struct {
	Kind    string `json:"kind"`
	Pending int    `json:"pending"`
	Running int    `json:"running"`
	Done    int    `json:"done"`
	Failed  int    `json:"failed"`
}

// Status is the queue as System shows it.
type Status struct {
	Workers []Worker    `json:"workers"`
	Kinds   []KindCount `json:"kinds"`
	// OldestWaiting is when the oldest due pending job became due; nil for none.
	OldestWaiting *time.Time `json:"oldest_waiting"`
	// Failed are the jobs that failed for good in the last 7 days, newest first (at most 20).
	Failed []Job `json:"failed"`
	// FailedRecently is how many did.
	FailedRecently int `json:"failed_recently"`
}

// Status reads the workers, the jobs by kind and state, and recent failures.
func (q *Queue) Status(ctx context.Context) (Status, error) {
	now := q.now()
	st := Status{Workers: []Worker{}, Kinds: []KindCount{}, Failed: []Job{}}
	rows, err := q.pool.Query(ctx, `SELECT name, version, tools, kinds, started_at, seen_at FROM outbox.workers ORDER BY seen_at DESC`)
	if err != nil {
		return st, err
	}
	for rows.Next() {
		var w Worker
		var tools []byte
		if err := rows.Scan(&w.Name, &w.Version, &tools, &w.Kinds, &w.StartedAt, &w.SeenAt); err != nil {
			rows.Close()
			return st, err
		}
		_ = json.Unmarshal(tools, &w.Tools)
		w.Alive = Alive(w, now)
		st.Workers = append(st.Workers, w)
	}
	rows.Close()
	rows, err = q.pool.Query(ctx, `SELECT kind, count(*) FILTER (WHERE state = 'pending'), count(*) FILTER (WHERE state = 'running'),
		count(*) FILTER (WHERE state = 'done'), count(*) FILTER (WHERE state = 'failed') FROM outbox.jobs GROUP BY kind ORDER BY kind`)
	if err != nil {
		return st, err
	}
	for rows.Next() {
		var k KindCount
		if err := rows.Scan(&k.Kind, &k.Pending, &k.Running, &k.Done, &k.Failed); err != nil {
			rows.Close()
			return st, err
		}
		st.Kinds = append(st.Kinds, k)
	}
	rows.Close()
	if err := q.pool.QueryRow(ctx, `SELECT min(run_after) FROM outbox.jobs WHERE state = 'pending' AND run_after <= $1`, now).Scan(&st.OldestWaiting); err != nil {
		return st, err
	}
	week := now.Add(-7 * 24 * time.Hour)
	if err := q.pool.QueryRow(ctx, `SELECT count(*) FROM outbox.jobs WHERE state = 'failed' AND finished_at >= $1`, week).Scan(&st.FailedRecently); err != nil {
		return st, err
	}
	rows, err = q.pool.Query(ctx, `SELECT `+jobColumns+` FROM outbox.jobs WHERE state = 'failed' AND finished_at >= $1 ORDER BY finished_at DESC LIMIT 20`, week)
	if err != nil {
		return st, err
	}
	defer rows.Close()
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			return st, err
		}
		st.Failed = append(st.Failed, j)
	}
	return st, rows.Err()
}

// Listener holds a connection listening on Channel for the worker's life,
// so a notification sent while the worker is busy is not missed.
type Listener struct {
	conn *pgxpool.Conn
}

// Listen starts listening.
func (q *Queue) Listen(ctx context.Context) (*Listener, error) {
	conn, err := q.pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := conn.Exec(ctx, `LISTEN `+Channel); err != nil {
		conn.Release()
		return nil, err
	}
	return &Listener{conn: conn}, nil
}

// Wait returns when a job may be due: a notification (perhaps one already
// received), poll passing, or ctx ending. An error means the connection is
// lost; the caller listens again.
func (l *Listener) Wait(ctx context.Context, poll time.Duration) error {
	waitCtx, cancel := context.WithTimeout(ctx, poll)
	defer cancel()
	_, err := l.conn.Conn().WaitForNotification(waitCtx)
	if err != nil && waitCtx.Err() != nil {
		return nil
	}
	return err
}

// Close stops listening; a connection that failed is not given back to the pool.
func (l *Listener) Close() {
	if l.conn.Conn().IsClosed() {
		l.conn.Release()
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := l.conn.Exec(ctx, `UNLISTEN `+Channel); err != nil {
		_ = l.conn.Conn().Close(ctx)
	}
	l.conn.Release()
}
