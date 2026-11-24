package share

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func newTestPool(t *testing.T) (*pgxpool.Pool, uuid.UUID, uuid.UUID) {
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
	if _, err := pool.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users CASCADE`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	ids := [2]uuid.UUID{uuid.New(), uuid.New()}
	for i, id := range ids {
		if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, created_at, updated_at,
			created_by_user_id, updated_by_user_id) VALUES ($1, $2, $3, 'x', now(), now(), $1, $1)`,
			id, uuid.NewString()[:8]+"@example.com", []string{"Sharer", "Other"}[i]); err != nil {
			t.Fatalf("insert user: %v", err)
		}
	}
	return pool, ids[0], ids[1]
}

func TestPostgresShares(t *testing.T) {
	pool, actor, other := newTestPool(t)
	ctx := context.Background()
	c := &clock{at: time.Now().UTC().Truncate(time.Microsecond)}
	svc := NewService(NewPostgresRepository(pool), WithClock(c.now))

	p := params(2)
	sh, token, err := svc.Create(ctx, p, actor)
	if err != nil {
		t.Fatal(err)
	}
	if sh.CreatedByName != "Sharer" || len(sh.SubjectIDs) != 2 || sh.SubjectIDs[0] != p.SubjectIDs[0] || !sh.CreatedAt.Equal(c.at) {
		t.Errorf("created = %+v", sh)
	}
	var stored string
	if err := pool.QueryRow(ctx, `SELECT token_hash FROM shares WHERE id = $1`, sh.ID).Scan(&stored); err != nil || stored == token || stored != HashToken(token) {
		t.Errorf("stored hash %q (%v)", stored, err)
	}
	opened, err := svc.Open(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	var row map[string]string
	if len(opened.Rows) != 2 || json.Unmarshal(opened.Rows[1], &row) != nil || row["full_name"] != "Person B" {
		t.Errorf("rows = %s", opened.Rows)
	}
	var events int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_type = 'share' AND entity_id = $1`, sh.ID).Scan(&events)
	if events != 1 {
		t.Errorf("events after create = %d", events)
	}

	// A second, one-day link; the list is newest first and the sharer's alone.
	p1 := params(1)
	p1.Days = 1
	c.at = c.at.Add(time.Minute)
	short, _, err := svc.Create(ctx, p1, actor)
	if err != nil {
		t.Fatal(err)
	}
	list, err := svc.List(ctx, actor)
	if err != nil || len(list) != 2 || list[0].ID != short.ID || len(list[0].Rows) != 0 || list[1].RowCount != 2 {
		t.Errorf("list = %+v, %v", list, err)
	}
	if others, _ := svc.List(ctx, other); len(others) != 0 {
		t.Errorf("another's list = %+v", others)
	}

	if err := svc.Revoke(ctx, sh.ID, other); !errors.Is(err, ErrNotFound) {
		t.Errorf("revoke another's: %v", err)
	}
	if err := svc.Revoke(ctx, sh.ID, actor); err != nil {
		t.Fatal(err)
	}
	var rows string
	var erased *time.Time
	_ = pool.QueryRow(ctx, `SELECT rows::text, erased_at FROM shares WHERE id = $1`, sh.ID).Scan(&rows, &erased)
	if rows != "[]" || erased == nil {
		t.Errorf("after revoke rows %s erased %v", rows, erased)
	}
	if _, err := svc.Open(ctx, token); !errors.Is(err, ErrGone) {
		t.Errorf("open revoked: %v", err)
	}

	// The one-day link expires; the upkeep erases it once.
	c.at = c.at.AddDate(0, 0, 1)
	if n, err := svc.EraseExpired(ctx); err != nil || n != 1 {
		t.Errorf("erased %d, %v", n, err)
	}
	if n, _ := svc.EraseExpired(ctx); n != 0 {
		t.Errorf("erased again %d", n)
	}
	if list, _ := svc.List(ctx, actor); len(list) != 0 {
		t.Errorf("list after expiry = %+v", list)
	}
	// The CHECK keeps one row per subject until erased.
	if _, err := pool.Exec(ctx, `UPDATE shares SET rows = '[]' WHERE id = $1`, short.ID); err != nil {
		t.Errorf("erased link emptied again: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE shares SET erased_at = NULL WHERE id = $1`, short.ID); err == nil {
		t.Error("unerased link with no rows was accepted")
	}
}
