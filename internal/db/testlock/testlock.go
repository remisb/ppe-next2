// Package testlock keeps one test run at a time on the shared test database
// (ppe2_test). Every session and worktree on a machine shares that database
// and the e2e ports, and a run empties the database as it starts, so a
// second run started meanwhile wrecks the first. A run holds a Postgres
// advisory lock on the database for its whole length, from a connection
// named after it, so the next one waits and can say who it waits for; the
// lock goes with the connection, so a run that crashes frees it too.
package testlock

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Key is the advisory lock's key ("PPET"); web/e2e/env.ts' testLockKey is
// the same number (TestE2EUsesTheSameKey).
const Key int64 = 0x50504554

// key is the lock this package takes: Key, but another in its own tests,
// which run inside a run that holds Key.
var key = Key

// EnvToken is the environment variable a locked run's commands inherit, so a
// run started inside one (make e2e running pnpm e2e) knows the lock is its own.
const EnvToken = "PPE_TEST_LOCK"

// appPrefix starts the application_name of a lock's connection, followed by
// its token and what the run is; Postgres keeps the first 63 bytes.
const appPrefix = "ppe-test-lock "

// Holder is a run holding the lock: what it said it is, and since when.
type Holder struct {
	Token string
	What  string
	Since time.Time
}

func (h Holder) String() string {
	return fmt.Sprintf("%s (since %s)", h.What, h.Since.Local().Format("15:04:05"))
}

// NewToken is a token for a new run.
func NewToken() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// AppName is the application_name of a run's lock connection.
func AppName(token, what string) string {
	name := appPrefix + token + " " + what
	if len(name) > 63 {
		name = name[:63]
	}
	return name
}

// HolderOf reads who holds the lock, through any connection to the database;
// ok is false when no one does.
func HolderOf(ctx context.Context, conn *pgx.Conn) (h Holder, ok bool, err error) {
	var app string
	err = conn.QueryRow(ctx, `SELECT a.application_name, a.backend_start FROM pg_locks l JOIN pg_stat_activity a USING (pid)
		WHERE l.locktype = 'advisory' AND l.granted AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
		AND l.classid::bigint = $1 AND l.objid::bigint = $2 AND l.objsubid = 1`, key>>32, key&0xffffffff).Scan(&app, &h.Since)
	if errors.Is(err, pgx.ErrNoRows) {
		return Holder{}, false, nil
	}
	if err != nil {
		return Holder{}, false, err
	}
	rest := strings.TrimPrefix(app, appPrefix)
	h.Token, h.What, _ = strings.Cut(rest, " ")
	if rest == app {
		h.Token, h.What = "", app
	}
	return h, true, nil
}

// Lock is a held lock; Release frees it (closing the connection frees it too).
type Lock struct {
	conn  *pgx.Conn
	Token string
}

func (l *Lock) Release(ctx context.Context) error { return l.conn.Close(ctx) }

// Acquire connects to dsn as the run what and holds the lock, trying until
// wait has passed and telling waiting (at once, then every half minute) who
// holds it meanwhile.
func Acquire(ctx context.Context, dsn, token, what string, wait time.Duration, waiting func(Holder)) (*Lock, error) {
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	cfg.RuntimeParams["application_name"] = AppName(token, what)
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(wait)
	var told time.Time
	for {
		var got bool
		if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, key).Scan(&got); err != nil {
			_ = conn.Close(ctx)
			return nil, err
		}
		if got {
			return &Lock{conn: conn, Token: token}, nil
		}
		h, held, err := HolderOf(ctx, conn)
		if err != nil {
			_ = conn.Close(ctx)
			return nil, err
		}
		if !time.Now().Before(deadline) {
			_ = conn.Close(ctx)
			if held {
				return nil, fmt.Errorf("the test database is still in use by %s", h)
			}
			return nil, errors.New("the test database's lock could not be taken")
		}
		if held && waiting != nil && time.Since(told) >= 30*time.Second {
			waiting(h)
			told = time.Now()
		}
		select {
		case <-ctx.Done():
			_ = conn.Close(context.Background())
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}
