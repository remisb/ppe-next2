package settings

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

func TestPostgresSupplierChat(t *testing.T) {
	pool, actor := newTestPool(t)
	svc := NewService(NewPostgresRepository(pool))
	ctx := context.Background()

	// TRUNCATE users CASCADE took the row with it: no row reads as the defaults.
	s, err := svc.Get(ctx)
	if err != nil || s.SupplierChat.Set() {
		t.Fatalf("Get on an empty table = %+v, %v", s, err)
	}

	link := "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv"
	if _, err := svc.UpdateSupplierChat(ctx, SupplierChatParams{Name: "Superman Rubai Group", Link: link}, actor); err != nil {
		t.Fatal(err)
	}
	// The second save updates the one row rather than adding another.
	if _, err := svc.UpdateSupplierChat(ctx, SupplierChatParams{Name: "Superman Rubai", Link: link}, actor); err != nil {
		t.Fatal(err)
	}
	s, err = svc.Get(ctx)
	if err != nil || s.SupplierChat != (SupplierChat{Name: "Superman Rubai", Link: link}) || s.UpdatedByUserID != actor {
		t.Fatalf("Get = %+v, %v", s, err)
	}
	var rows, events int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM app_settings`).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("app_settings rows = %d, %v", rows, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE event = $1 AND entity_id = $2`,
		EventSupplierChatChanged, AuditEntityID).Scan(&events); err != nil || events != 2 {
		t.Fatalf("events = %d, %v", events, err)
	}

	// An actor that is no user is an authentication problem.
	if _, err := svc.UpdateSupplierChat(ctx, SupplierChatParams{}, uuid.New()); !errors.Is(err, ErrActorNotFound) {
		t.Fatalf("unknown actor: err = %v, want ErrActorNotFound", err)
	}
}
