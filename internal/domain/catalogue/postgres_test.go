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

	p := Params{Name: "Work trousers", SizeGroup: size.GroupClothing, PurchasePriceCents: i64(1900), AccountingPriceCents: i64(2500),
		ServicePeriodMonths: ip(12), Active: true, DisplayRank: ip(3)}
	i, err := svc.Create(ctx, p, actor)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := svc.Get(ctx, i.ID); *got.PurchasePriceCents != 1900 || *got.AccountingPriceCents != 2500 {
		t.Errorf("prices read back = %v, %v", got.PurchasePriceCents, got.AccountingPriceCents)
	}
	draft, err := svc.Create(ctx, Params{Name: "Helmet", SizeGroup: size.GroupNone, Active: true}, actor)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := svc.Get(ctx, draft.ID)
	if got.PurchasePriceCents != nil || got.AccountingPriceCents != nil || got.ServicePeriodMonths != nil || got.Orderable() || got.Icon != IconOther {
		t.Errorf("draft item = %+v", got)
	}
	// The pictogram is stored and read back; the database refuses one the app cannot draw.
	if _, err := svc.Update(ctx, draft.ID, Params{Name: "Helmet", SizeGroup: size.GroupNone, Active: true, Icon: IconHelmet}, actor); err != nil {
		t.Fatal(err)
	}
	if got, _ := svc.Get(ctx, draft.ID); got.Icon != IconHelmet {
		t.Errorf("icon = %q", got.Icon)
	}
	// The database accepts every pictogram the app draws: its CHECK and Icons list the same set.
	for _, icon := range Icons {
		if _, err := pool.Exec(ctx, `UPDATE catalogue_items SET icon = $2 WHERE id = $1`, draft.ID, string(icon)); err != nil {
			t.Errorf("the database refused icon %q: %v", icon, err)
		}
	}
	if _, err := pool.Exec(ctx, `UPDATE catalogue_items SET icon = 'boot' WHERE id = $1`, draft.ID); err == nil {
		t.Error("the database accepted an unknown icon")
	}

	p.PurchasePriceCents, p.AccountingPriceCents = i64(2000), i64(2750)
	if _, err := svc.Update(ctx, i.ID, p, actor); err != nil {
		t.Fatal(err)
	}
	var before, after string
	if err := pool.QueryRow(ctx, `SELECT before->>'accounting_price_cents', after->>'accounting_price_cents' FROM audit_events
		WHERE entity_id = $1 AND event = $2`, i.ID, EventPriceChanged).Scan(&before, &after); err != nil {
		t.Fatalf("price event: %v", err)
	}
	if before != "2500" || after != "2750" {
		t.Errorf("price event %s -> %s", before, after)
	}
	h, err := svc.PriceHistory(ctx, i.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(h) != 2 || h[0].Event != EventPriceChanged || *h[0].BeforeAccountingCents != 2500 || *h[0].AccountingPriceCents != 2750 ||
		*h[0].BeforePurchaseCents != 1900 || *h[0].PurchasePriceCents != 2000 ||
		*h[0].ServicePeriodMonths != 12 || *h[0].ByName != "Actor" || h[1].Event != EventCreated || *h[1].AccountingPriceCents != 2500 ||
		h[1].BeforeAccountingCents != nil || h[0].At.Before(h[1].At) {
		t.Errorf("price history = %+v", h)
	}

	// Events written before migration 0021 name the accounting price
	// unit_price_cents and have no purchase price; the history still reads them.
	legacy := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO audit_events (id, actor_user_id, event, entity_type, entity_id, occurred_at, before, after)
		VALUES ($1, $2, $3, $4, $5, now() + interval '1 minute', '{"unit_price_cents": 2400, "currency": "EUR", "service_period_months": 12}',
			'{"unit_price_cents": 2500, "currency": "EUR", "service_period_months": 12}')`,
		legacy, actor, EventPriceChanged, auditEntity, i.ID); err != nil {
		t.Fatalf("insert legacy event: %v", err)
	}
	h, _ = svc.PriceHistory(ctx, i.ID)
	if len(h) != 3 || *h[0].BeforeAccountingCents != 2400 || *h[0].AccountingPriceCents != 2500 ||
		h[0].PurchasePriceCents != nil || h[0].BeforePurchaseCents != nil {
		t.Errorf("legacy event in history = %+v", h)
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
