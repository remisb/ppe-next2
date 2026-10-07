package security

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// newTestPool connects to API_TEST_DB_DSN, skipping when it is unset, and
// empties users, and with them auth_events, sessions and roles.
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
	if _, err := pool.Exec(ctx, `TRUNCATE users, audit_events CASCADE`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return pool
}

func insertUser(t *testing.T, pool *pgxpool.Pool, name string, created time.Time, lastSignIn *time.Time) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, email, name, password_hash, created_at, updated_at, created_by_user_id, updated_by_user_id, last_sign_in_at)
		VALUES ($1, $2, $3, 'x', $4, $4, $1, $1, $5)`, id, strings.ToLower(name)+"@example.com", name, created, lastSignIn); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestPostgresSecurityLog(t *testing.T) {
	pool := newTestPool(t)
	ctx := audit.WithRequest(context.Background(), audit.Request{
		ID: "req-1", Source: audit.SourceAdmin, IP: "203.0.113.9", UserAgent: strings.Repeat("u", 500),
	})
	now := time.Now().UTC().Truncate(time.Microsecond)
	store := NewPostgresStore(pool)
	svc := NewService(store, Config{Key: []byte(strings.Repeat("k", 32)), Failures: 2, Interval: time.Hour},
		WithClock(func() time.Time { return now }))
	ona := insertUser(t, pool, "Ona", now, nil)
	hash := svc.EmailHash("ona@example.com")
	ghost := svc.EmailHash("ghost@example.com")

	if err := svc.Refused(ctx, KindSignInFailed, ghost, uuid.Nil, ReasonUnknownEmail); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		now = now.Add(time.Second)
		if err := svc.Refused(ctx, KindSignInFailed, hash, ona, ReasonBadPassword); err != nil {
			t.Fatal(err)
		}
	}
	if wait, err := svc.Blocked(ctx, hash); err != nil || wait <= 59*time.Minute {
		t.Errorf("blocked = %v, %v; want about an hour", wait, err)
	}
	if wait, _ := svc.Blocked(ctx, ghost); wait != 0 {
		t.Error("one failure blocked the other email")
	}
	// A success (written by the session repository) clears them.
	now = now.Add(time.Second)
	if err := Insert(ctx, pool, Event{ID: uuid.New(), OccurredAt: now, Kind: KindSignIn, UserID: &ona, EmailHash: hash}); err != nil {
		t.Fatal(err)
	}
	if wait, _ := svc.Blocked(ctx, hash); wait != 0 {
		t.Error("still blocked after a sign-in")
	}

	page, err := svc.List(ctx, Filter{PageSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Events) != 2 || page.Next == nil || page.Events[0].Kind != KindSignIn {
		t.Fatalf("first page = %+v", page)
	}
	e := page.Events[0]
	if *e.UserName != "Ona" || *e.UserEmail != "ona@example.com" || *e.IP != "203.0.113.9" || len(*e.UserAgent) != 400 ||
		*e.RequestID != "req-1" || *e.Source != audit.SourceAdmin || e.EmailRef == nil || len(*e.EmailRef) != 8 {
		t.Errorf("entry = %+v", e)
	}
	c, _ := audit.ParseCursor(*page.Next)
	rest, err := svc.List(ctx, Filter{After: &c})
	if err != nil || len(rest.Events) != 2 || rest.Next != nil || rest.Events[1].UserID != nil || *rest.Events[1].Reason != ReasonUnknownEmail {
		t.Errorf("second page = %+v, %v", rest, err)
	}
	if only, _ := svc.List(ctx, Filter{UserID: &ona, Kind: KindSignInFailed}); len(only.Events) != 2 {
		t.Errorf("Ona's failures = %d", len(only.Events))
	}

	// Rows are never changed, and only the purge deletes, never recent ones.
	if _, err := pool.Exec(ctx, `UPDATE auth_events SET ip = NULL`); err == nil {
		t.Error("UPDATE allowed")
	}
	if _, err := pool.Exec(ctx, `DELETE FROM auth_events`); err == nil {
		t.Error("DELETE allowed outside the purge")
	}
	old := time.Now().Add(-200 * 24 * time.Hour)
	if err := Insert(ctx, pool, Event{ID: uuid.New(), OccurredAt: old, Kind: KindSignInFailed, EmailHash: ghost, Reason: ReasonUnknownEmail}); err != nil {
		t.Fatal(err)
	}
	n, err := store.Purge(ctx, time.Now().Add(-180*24*time.Hour))
	if err != nil || n != 1 {
		t.Errorf("purge = %d, %v; want the one old row", n, err)
	}
	if _, err := store.Purge(ctx, time.Now()); err == nil {
		t.Error("the purge deleted rows younger than 30 days")
	}
}

func TestPostgresSessionsAndReview(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	store := NewPostgresStore(pool)
	svc := NewService(store, Config{}, WithClock(func() time.Time { return now }))

	recent := now.Add(-time.Hour)
	ana := insertUser(t, pool, "Ana", now.Add(-200*24*time.Hour), &recent)
	bo := insertUser(t, pool, "Bo", now.Add(-200*24*time.Hour), nil)
	if _, err := pool.Exec(ctx, `
		INSERT INTO roles (id, key, name, created_at, updated_at) VALUES
			('a0e1d000-0000-4000-8000-000000000001', 'admin', 'Administrator', now(), now());
		INSERT INTO roles (id, name, created_at, updated_at, created_by_user_id, updated_by_user_id) VALUES
			('b0000000-0000-4000-8000-000000000001', 'Storekeeper', now(), now(), '`+ana.String()+`', '`+ana.String()+`'),
			('b0000000-0000-4000-8000-000000000002', 'Unused', now(), now(), '`+ana.String()+`', '`+ana.String()+`');
		INSERT INTO role_permissions VALUES
			('a0e1d000-0000-4000-8000-000000000001', 'users.manage'),
			('a0e1d000-0000-4000-8000-000000000001', 'audit.read'),
			('b0000000-0000-4000-8000-000000000001', 'audit.read');
		INSERT INTO user_roles VALUES
			('`+ana.String()+`', 'a0e1d000-0000-4000-8000-000000000001'),
			('`+ana.String()+`', 'b0000000-0000-4000-8000-000000000001');`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_sessions (id, user_id, seed, generation, rotated_at, keep_signed_in, created_at, authenticated_at,
			last_used_at, idle_expires_at, expires_at, user_agent, ip)
		VALUES (gen_random_uuid(), $1, 'x', 1, $2, true, $2, $2, $2, $3, $4, 'Firefox', '203.0.113.1'),
			(gen_random_uuid(), $1, 'x', 1, $2, true, $2, $2, $2, $2, $2, 'Expired', '203.0.113.2')`,
		ana, recent, now.Add(time.Hour), now.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}

	live, err := svc.Sessions(ctx)
	if err != nil || len(live) != 1 || live[0].UserName != "Ana" || live[0].UserAgent != "Firefox" || !live[0].ExpiresAt.Equal(now.Add(time.Hour)) {
		t.Fatalf("live sessions = %+v, %v", live, err)
	}

	r, err := svc.Review(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Users) != 2 || r.Users[0].ID != ana || r.Users[1].ID != bo {
		t.Fatalf("users = %+v", r.Users)
	}
	a := r.Users[0]
	if a.LiveSessions != 1 || len(a.Roles) != 2 || a.Roles[0].Name != "Administrator" ||
		strings.Join(a.Permissions, ",") != "audit.read,users.manage" || strings.Join(a.Flags, ",") != FlagAdministrator {
		t.Errorf("Ana = %+v", a)
	}
	if b := r.Users[1]; len(b.Roles) != 0 || len(b.Permissions) != 0 || strings.Join(b.Flags, ",") != "no_sign_in,dormant" {
		t.Errorf("Bo = %+v", b)
	}
	if len(r.UnusedRoles) != 1 || r.UnusedRoles[0].Name != "Unused" || r.LastReview != nil {
		t.Errorf("unused %+v, last %+v", r.UnusedRoles, r.LastReview)
	}

	r, err = svc.MarkReviewed(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	if r.LastReview == nil || *r.LastReview.ByName != "Ana" || !r.LastReview.At.Equal(now) {
		t.Errorf("last review = %+v", r.LastReview)
	}
	var after string
	if err := pool.QueryRow(ctx, `SELECT after::text FROM audit_events WHERE event = $1`, EventAccessReviewCompleted).Scan(&after); err != nil ||
		!strings.Contains(after, `"dormant": 1`) || !strings.Contains(after, `"administrators": 1`) {
		t.Errorf("recorded %s, %v", after, err)
	}
}
