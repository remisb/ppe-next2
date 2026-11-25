package outbox

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/db/dbtest"
)

// newQueue empties the jobs and workers and returns a queue connected as
// ppe_app, its clock at *now, and the owner's pool.
func newQueue(t *testing.T) (*Queue, *pgxpool.Pool, *time.Time) {
	t.Helper()
	dsn := os.Getenv("API_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	if _, err := owner.Exec(ctx, `TRUNCATE outbox.jobs, outbox.workers`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	now := time.Date(2026, 11, 25, 9, 0, 0, 0, time.UTC)
	q := NewQueue(dbtest.AppPool(t, owner, dsn)).WithClock(func() time.Time { return now })
	return q, owner, &now
}

func jobState(t *testing.T, owner *pgxpool.Pool, id uuid.UUID) (state string, attempts int, runAfter time.Time, lastError string) {
	t.Helper()
	if err := owner.QueryRow(context.Background(), `SELECT state, attempts, run_after, coalesce(last_error, '') FROM outbox.jobs WHERE id = $1`, id).
		Scan(&state, &attempts, &runAfter, &lastError); err != nil {
		t.Fatal(err)
	}
	return
}

func TestPostgresQueue(t *testing.T) {
	q, owner, now := newQueue(t)
	ctx := context.Background()
	kinds := []string{"test.job"}

	// One live job per kind and key.
	if err := q.Enqueue(ctx, "test.job", "a", map[string]string{"id": "a"}); err != nil {
		t.Fatal(err)
	}
	if err := q.Enqueue(ctx, "test.job", "a", map[string]string{"id": "a"}); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = owner.QueryRow(ctx, `SELECT count(*) FROM outbox.jobs`).Scan(&n)
	if n != 1 {
		t.Fatalf("jobs = %d, want 1", n)
	}

	// Another kind is not claimed.
	if _, ok, err := q.Claim(ctx, "w1", []string{"other.job"}, time.Minute); err != nil || ok {
		t.Fatalf("claim other kind = %v, %v", ok, err)
	}
	j, ok, err := q.Claim(ctx, "w1", kinds, time.Minute)
	if err != nil || !ok {
		t.Fatalf("claim = %v, %v", ok, err)
	}
	if j.Attempts != 1 || j.State != "running" || string(j.Payload) != `{"id": "a"}` {
		t.Fatalf("claimed %+v (payload %s)", j, j.Payload)
	}
	// Running, it is not claimed again until its lease runs out.
	if _, ok, _ := q.Claim(ctx, "w2", kinds, time.Minute); ok {
		t.Fatal("a leased job was claimed twice")
	}
	// While it runs, the same change enqueues it again: a second live job is not made.
	if err := q.Enqueue(ctx, "test.job", "a", nil); err != nil {
		t.Fatal(err)
	}
	_ = owner.QueryRow(ctx, `SELECT count(*) FROM outbox.jobs`).Scan(&n)
	if n != 1 {
		t.Fatalf("jobs = %d, want 1 while running", n)
	}

	// A failure is retried after the back-off.
	if err := q.Fail(ctx, j, errors.New("pdftotext: exit 1")); err != nil {
		t.Fatal(err)
	}
	state, attempts, runAfter, lastErr := jobState(t, owner, j.ID)
	if state != "pending" || attempts != 1 || !runAfter.Equal(now.Add(30*time.Second)) || lastErr != "pdftotext: exit 1" {
		t.Fatalf("after fail: %s %d %s %q", state, attempts, runAfter, lastErr)
	}
	if _, ok, _ := q.Claim(ctx, "w1", kinds, time.Minute); ok {
		t.Fatal("claimed before its back-off ended")
	}
	*now = now.Add(31 * time.Second)
	j, ok, _ = q.Claim(ctx, "w1", kinds, time.Minute)
	if !ok || j.Attempts != 2 {
		t.Fatalf("second claim = %v, %+v", ok, j)
	}

	// The lease runs out: another worker takes it, and the first one's outcome is refused.
	*now = now.Add(2 * time.Minute)
	j2, ok, _ := q.Claim(ctx, "w2", kinds, time.Minute)
	if !ok || j2.ID != j.ID || j2.Attempts != 3 {
		t.Fatalf("claim after lease = %v, %+v", ok, j2)
	}
	if err := q.Done(ctx, j); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("stale done = %v, want ErrLeaseLost", err)
	}
	if err := q.Done(ctx, j2); err != nil {
		t.Fatal(err)
	}
	if state, _, _, _ := jobState(t, owner, j.ID); state != "done" {
		t.Fatalf("state = %s, want done", state)
	}
	// Done, the same kind and key may be enqueued again (Read Again).
	if err := q.Retry(ctx, "test.job", "a", nil); err != nil {
		t.Fatal(err)
	}
	_ = owner.QueryRow(ctx, `SELECT count(*) FROM outbox.jobs WHERE state = 'pending'`).Scan(&n)
	if n != 1 {
		t.Fatalf("pending after retry = %d, want 1", n)
	}

	// A permanent error fails at once; spent attempts fail too.
	j, _, _ = q.Claim(ctx, "w1", kinds, time.Minute)
	if err := q.Fail(ctx, j, Permanent(errors.New("not a PDF"))); err != nil {
		t.Fatal(err)
	}
	if state, _, _, _ := jobState(t, owner, j.ID); state != "failed" {
		t.Fatalf("permanent: state = %s", state)
	}
	if err := q.Enqueue(ctx, "test.job", "b", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.Exec(ctx, `UPDATE outbox.jobs SET max_attempts = 1 WHERE key = 'b'`); err != nil {
		t.Fatal(err)
	}
	jb, _, _ := q.Claim(ctx, "w1", kinds, time.Minute)
	if err := q.Fail(ctx, jb, errors.New("again")); err != nil {
		t.Fatal(err)
	}
	if state, _, _, _ := jobState(t, owner, jb.ID); state != "failed" {
		t.Fatalf("spent: state = %s", state)
	}

	// Status counts by kind and lists the failures.
	if err := q.Heartbeat(ctx, Worker{Name: "w1", Version: "test", Tools: map[string]string{"tesseract": "5.5"}, Kinds: kinds, StartedAt: *now}); err != nil {
		t.Fatal(err)
	}
	st, err := q.Status(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Workers) != 1 || st.Workers[0].Tools["tesseract"] != "5.5" || len(st.Kinds) != 1 || st.Kinds[0].Done != 1 || st.Kinds[0].Failed != 2 ||
		st.FailedRecently != 2 || len(st.Failed) != 2 || st.OldestWaiting != nil {
		t.Fatalf("status = %+v", st)
	}

	// ppe_app may not delete jobs; the purge does, as the owner.
	if _, err := q.pool.Exec(ctx, `DELETE FROM outbox.jobs`); err == nil {
		t.Fatal("ppe_app deleted jobs")
	}
	*now = now.Add(8 * 24 * time.Hour)
	if n, err := q.Purge(ctx); err != nil || n != 1 {
		t.Fatalf("purge after 8 days = %d, %v; want the done job", n, err)
	}
	*now = now.Add(90 * 24 * time.Hour)
	if n, err := q.Purge(ctx); err != nil || n != 2 {
		t.Fatalf("purge after 98 days = %d, %v; want the failed jobs", n, err)
	}
}

func TestPostgresTwoClaimers(t *testing.T) {
	q, _, _ := newQueue(t)
	ctx := context.Background()
	const jobs = 40
	for i := range jobs {
		if err := q.Enqueue(ctx, "test.job", uuid.NewString(), map[string]int{"n": i}); err != nil {
			t.Fatal(err)
		}
	}
	var mu sync.Mutex
	seen := map[uuid.UUID]int{}
	var wg sync.WaitGroup
	for w := range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				j, ok, err := q.Claim(ctx, "w"+string(rune('0'+w)), []string{"test.job"}, time.Minute)
				if err != nil {
					t.Error(err)
					return
				}
				if !ok {
					return
				}
				mu.Lock()
				seen[j.ID]++
				mu.Unlock()
				if err := q.Done(ctx, j); err != nil {
					t.Error(err)
				}
			}
		}()
	}
	wg.Wait()
	if len(seen) != jobs {
		t.Fatalf("claimed %d jobs, want %d", len(seen), jobs)
	}
	for id, n := range seen {
		if n != 1 {
			t.Fatalf("job %s claimed %d times", id, n)
		}
	}
}

func TestPostgresRunner(t *testing.T) {
	q, owner, _ := newQueue(t)
	q.WithClock(func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var ran atomic.Int32
	got := make(chan string, 10)
	r := &Runner{
		Queue: q,
		Handlers: map[string]Handler{
			"test.job": func(ctx context.Context, j Job) error {
				ran.Add(1)
				got <- j.Key
				return nil
			},
			"test.slow": func(ctx context.Context, j Job) error {
				<-ctx.Done()
				return ctx.Err()
			},
			"test.panic": func(ctx context.Context, j Job) error { panic("boom") },
		},
		Worker:  Worker{Name: "test-worker", Version: "test"},
		Timeout: 300 * time.Millisecond,
		Poll:    time.Hour, // only a notification wakes it
		Logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	done := make(chan error, 1)
	go func() { done <- r.Run(ctx) }()

	// Enqueued after the runner waits: the notification wakes it.
	time.Sleep(200 * time.Millisecond)
	if err := q.Enqueue(ctx, "test.job", "k1", nil); err != nil {
		t.Fatal(err)
	}
	select {
	case k := <-got:
		if k != "k1" {
			t.Fatalf("ran %s", k)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the notification did not wake the runner")
	}
	if err := q.Enqueue(ctx, "test.slow", "s", nil); err != nil {
		t.Fatal(err)
	}
	if err := q.Enqueue(ctx, "test.panic", "p", nil); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		var pending int
		_ = owner.QueryRow(ctx, `SELECT count(*) FROM outbox.jobs WHERE state IN ('pending', 'running') AND attempts = 0`).Scan(&pending)
		var errs []string
		rows, _ := owner.Query(ctx, `SELECT coalesce(last_error, '') FROM outbox.jobs WHERE kind <> 'test.job' AND last_error IS NOT NULL ORDER BY kind`)
		for rows.Next() {
			var s string
			_ = rows.Scan(&s)
			errs = append(errs, s)
		}
		rows.Close()
		if len(errs) == 2 {
			if errs[0] != "panic: boom" || errs[1] != "timed out after 300ms" {
				t.Fatalf("errors = %q", errs)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("errors = %q", errs)
		}
		time.Sleep(50 * time.Millisecond)
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	var kinds []string
	if err := owner.QueryRow(context.Background(), `SELECT kinds FROM outbox.workers WHERE name = 'test-worker'`).Scan(&kinds); err != nil || len(kinds) != 3 {
		t.Fatalf("heartbeat kinds = %v, %v", kinds, err)
	}
	if ran.Load() != 1 {
		t.Fatalf("ran %d times", ran.Load())
	}
}
