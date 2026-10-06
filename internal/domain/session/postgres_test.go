package session

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newTestPool connects to API_TEST_DB_DSN, skipping when it is unset, and
// empties users (and so user_sessions) first.
func newTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("API_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `TRUNCATE users CASCADE`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return pool
}

// insertUser adds a bare user row for sessions to belong to.
func insertUser(t *testing.T, pool *pgxpool.Pool, email string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, email, name, password_hash, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, $2, 'U', 'x', now(), now(), $1, $1)`, id, email); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestPostgresSessions(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	c := newClock()
	svc := NewService(NewPostgresRepository(pool), []byte(strings.Repeat("k", 32)), testLimits, WithClock(c.now))
	user := insertUser(t, pool, "ona@example.com")
	other := insertUser(t, pool, "jonas@example.com")

	s, t1, err := svc.Start(ctx, StartParams{UserID: user, KeepSignedIn: true, UserAgent: "Safari", IP: "203.0.113.1"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.Start(ctx, StartParams{UserID: uuid.New()}); !errors.Is(err, ErrInvalid) {
		t.Errorf("a session for no user: %v, want ErrInvalid", err)
	}

	// Rotation and the grace round-trip through the row.
	c.advance(time.Minute)
	got, t2, err := svc.Refresh(ctx, t1, Seen{UserAgent: "Safari 2", IP: "203.0.113.2"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Generation != 2 || got.UserAgent != "Safari 2" || !got.LastUsedAt.Equal(c.t) || !got.CreatedAt.Equal(s.CreatedAt) || string(got.Seed) != string(s.Seed) {
		t.Fatalf("after refresh: %+v", got)
	}
	if _, again, err := svc.Refresh(ctx, t1, Seen{}); err != nil || again != t2 {
		t.Fatalf("replaced token within grace: %v", err)
	}

	// The list holds live sessions only, last used first.
	c.advance(time.Minute)
	b, tb, _ := svc.Start(ctx, StartParams{UserID: user})
	if _, _, err := svc.Start(ctx, StartParams{UserID: other}); err != nil {
		t.Fatal(err)
	}
	live, err := svc.List(ctx, user)
	if err != nil || len(live) != 2 || live[0].ID != b.ID {
		t.Fatalf("live = %v, %v", live, err)
	}
	if err := svc.SignOut(ctx, tb); err != nil {
		t.Fatal(err)
	}
	if live, _ := svc.List(ctx, user); len(live) != 1 || live[0].ID != s.ID {
		t.Fatalf("after sign-out live = %v", live)
	}

	// Reuse after the grace ends it in the table.
	c.advance(RotationGrace)
	if _, _, err := svc.Refresh(ctx, t1, Seen{}); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("reused: %v", err)
	}
	var reason string
	if err := pool.QueryRow(ctx, `SELECT end_reason FROM user_sessions WHERE id = $1`, s.ID).Scan(&reason); err != nil || reason != ReasonReused {
		t.Fatalf("end_reason = %q, %v", reason, err)
	}

	// EndAll leaves the kept one and other users alone.
	keep, _, _ := svc.Start(ctx, StartParams{UserID: user})
	gone, _, _ := svc.Start(ctx, StartParams{UserID: user})
	if err := svc.EndAll(ctx, user, keep.ID, ReasonPasswordChanged); err != nil {
		t.Fatal(err)
	}
	if live, _ := svc.List(ctx, user); len(live) != 1 || live[0].ID != keep.ID {
		t.Fatalf("after EndAll live = %v (ended %v)", live, gone.ID)
	}
	if live, _ := svc.List(ctx, other); len(live) != 1 {
		t.Errorf("another user's sessions: %d", len(live))
	}

	// Ended over 30 days ago: the next sign-in deletes them.
	c.advance(31 * 24 * time.Hour)
	if _, _, err := svc.Start(ctx, StartParams{UserID: user}); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM user_sessions WHERE user_id = $1`, user).Scan(&n); err != nil || n != 1 {
		t.Errorf("rows after prune = %d, %v", n, err)
	}
}
