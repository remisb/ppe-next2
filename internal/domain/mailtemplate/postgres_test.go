package mailtemplate

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newTestPool empties the database and inserts an actor.
func newTestPool(t *testing.T) (*pgxpool.Pool, uuid.UUID) {
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
	if _, err := pool.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users, audit_events CASCADE`); err != nil {
		t.Fatal(err)
	}
	actor := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, created_at, updated_at,
		created_by_user_id, updated_by_user_id) VALUES ($1, 'a@example.com', 'A', 'x', now(), now(), $1, $1)`, actor); err != nil {
		t.Fatal(err)
	}
	return pool, actor
}

func TestPostgresTemplates(t *testing.T) {
	pool, actor := newTestPool(t)
	svc := NewService(NewPostgresRepository(pool))
	ctx := context.Background()
	u, _ := Find(KeySIMBlocking)

	// TRUNCATE users CASCADE took the rows with it: every template is its default.
	list, err := svc.List(ctx)
	if err != nil || len(list) != 2 || list[1].Text != u.Default || list[1].UpdatedAt != nil {
		t.Fatalf("List = %+v, %v", list, err)
	}
	p := TextParams{To: "sim@telia.lt", Subject: "Block {{sim.phone_number}}", Body: "Please block it."}
	if _, err := svc.Update(ctx, KeySIMBlocking, p, actor); err != nil {
		t.Fatal(err)
	}
	// The second save updates the one row rather than adding another.
	p.Body = "Please block it now."
	if _, err := svc.Update(ctx, KeySIMBlocking, p, actor); err != nil {
		t.Fatal(err)
	}
	got, err := svc.Get(ctx, KeySIMBlocking)
	if err != nil || got.To != "sim@telia.lt" || got.Body != "Please block it now." || got.UpdatedAt == nil || *got.UpdatedByUserID != actor {
		t.Fatalf("Get = %+v, %v", got, err)
	}
	if other, err := svc.Get(ctx, KeySIMActivation); err != nil || other.UpdatedAt != nil {
		t.Fatalf("the other template = %+v, %v", other, err)
	}
	var rows, events int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM mail_templates`).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("rows = %d, %v", rows, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE event = $1 AND entity_id = $2`,
		EventChanged, EntityID(KeySIMBlocking)).Scan(&events); err != nil || events != 2 {
		t.Fatalf("events = %d, %v", events, err)
	}
	// The database keeps each part set.
	if _, err := pool.Exec(ctx, `UPDATE mail_templates SET body = ''`); err == nil {
		t.Fatal("an empty body was stored")
	}
	// An actor that is no user is an authentication problem.
	if _, err := svc.Update(ctx, KeySIMActivation, p, uuid.New()); !errors.Is(err, ErrActorNotFound) {
		t.Fatalf("unknown actor: err = %v, want ErrActorNotFound", err)
	}
}
