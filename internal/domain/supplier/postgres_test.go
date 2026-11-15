package supplier

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

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
	if _, err := pool.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users CASCADE`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	actor := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, created_at, updated_at,
		created_by_user_id, updated_by_user_id) VALUES ($1, 'actor@example.com', 'Actor', 'x', now(), now(), $1, $1)`, actor); err != nil {
		t.Fatalf("insert actor: %v", err)
	}
	return pool, actor
}

func TestPostgresSuppliers(t *testing.T) {
	pool, actor := newTestPool(t)
	svc := NewService(NewPostgresRepository(pool))
	ctx := context.Background()

	s, err := svc.Create(ctx, Params{Code: "SUP-1", Name: "Darbo rūbai", CompanyCode: "300000001", VATCode: "LT100000000001",
		Address: "Gedimino pr. 1", City: "Vilnius", PostalCode: "LT-01103", Country: "LT", ContactPerson: "Jonas",
		Email: "orders@example.lt", Phone: "+370 600 00000", Website: "https://example.lt", BankAccount: "LT121000011101001000",
		Notes: "Calls back"}, actor)
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.Get(ctx, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Darbo rūbai" || got.Country != "LT" || got.BankAccount != "LT121000011101001000" || got.Notes != "Calls back" ||
		!got.CreatedAt.Equal(s.CreatedAt) || got.ItemCount != 0 {
		t.Errorf("read back = %+v", got)
	}
	if _, err := svc.Create(ctx, Params{Code: "sup-1", Name: "Other"}, actor); !errors.Is(err, ErrCodeTaken) {
		t.Errorf("same code, other case: %v", err)
	}
	other, err := svc.Create(ctx, Params{Code: "SUP-2", Name: "Avalynė"}, actor)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Update(ctx, other.ID, Params{Code: "Sup-1", Name: "Avalynė"}, actor); !errors.Is(err, ErrCodeTaken) {
		t.Errorf("taking another's code: %v", err)
	}

	// An item naming the supplier is counted.
	if _, err := pool.Exec(ctx, `INSERT INTO catalogue_items (id, name, icon, created_at, updated_at, created_by_user_id, updated_by_user_id, supplier_id)
		VALUES ($1, 'Boots', 'shoes', now(), now(), $2, $2, $3)`, uuid.New(), actor, s.ID); err != nil {
		t.Fatal(err)
	}
	list, err := svc.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].Name != "Avalynė" || list[1].ItemCount != 1 {
		t.Errorf("list = %+v", list)
	}

	if err := svc.Delete(ctx, s.ID, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(ctx, s.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleted read: %v", err)
	}
	if err := svc.Delete(ctx, s.ID, actor); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleting twice: %v", err)
	}
	if _, err := svc.Create(ctx, Params{Code: "SUP-1", Name: "Again"}, actor); err != nil {
		t.Errorf("reusing a deleted supplier's code: %v", err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_type = 'supplier' AND entity_id = $1`, s.ID).Scan(&n); err != nil || n != 2 {
		t.Errorf("events on the supplier = %d, %v; want created and deleted", n, err)
	}
	if _, err := svc.Create(ctx, Params{Code: "SUP-9", Name: "Ghost"}, uuid.New()); !errors.Is(err, ErrActorNotFound) {
		t.Errorf("unknown actor: %v", err)
	}
}
