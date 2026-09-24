package catalogue

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/domain/size"
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
	if _, err := pool.Exec(ctx, `TRUNCATE users CASCADE`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	actor := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, roles, created_at, updated_at,
		created_by_user_id, updated_by_user_id) VALUES ($1, 'actor@example.com', 'Actor', 'x', '{admin}', now(), now(), $1, $1)`, actor); err != nil {
		t.Fatalf("insert actor: %v", err)
	}
	return pool, actor
}

func TestPostgresCatalogue(t *testing.T) {
	pool, actor := newTestPool(t)
	svc := NewService(NewPostgresRepository(pool))
	ctx := context.Background()

	p := Params{Name: "Work trousers", SizeGroup: size.GroupClothing, UnitPriceCents: i64(2500), ServicePeriodMonths: ip(12), Active: true, DisplayRank: ip(3)}
	i, err := svc.Create(ctx, p, actor)
	if err != nil {
		t.Fatal(err)
	}
	draft, err := svc.Create(ctx, Params{Name: "Helmet", SizeGroup: size.GroupNone, Active: true}, actor)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := svc.Get(ctx, draft.ID)
	if got.UnitPriceCents != nil || got.ServicePeriodMonths != nil || got.Orderable() {
		t.Errorf("draft item = %+v", got)
	}

	p.UnitPriceCents = i64(2750)
	if _, err := svc.Update(ctx, i.ID, p, actor); err != nil {
		t.Fatal(err)
	}
	var before, after string
	if err := pool.QueryRow(ctx, `SELECT before->>'unit_price_cents', after->>'unit_price_cents' FROM audit_events
		WHERE entity_id = $1 AND event = $2`, i.ID, EventPriceChanged).Scan(&before, &after); err != nil {
		t.Fatalf("price event: %v", err)
	}
	if before != "2500" || after != "2750" {
		t.Errorf("price event %s -> %s", before, after)
	}

	if _, err := svc.SetActive(ctx, draft.ID, false, actor); err != nil {
		t.Fatal(err)
	}
	active, _ := svc.ListActive(ctx)
	if len(active) != 1 || active[0].ID != i.ID {
		t.Errorf("active = %+v", active)
	}
	if _, err := svc.Create(ctx, Params{Name: "WORK TROUSERS", SizeGroup: size.GroupNone}, actor); !errors.Is(err, ErrNameTaken) {
		t.Errorf("duplicate err = %v", err)
	}
}
