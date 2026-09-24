package itemset

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newTestPool empties the database and inserts an actor plus n catalogue items.
func newTestPool(t *testing.T, n int) (*pgxpool.Pool, uuid.UUID, []uuid.UUID) {
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
		t.Fatal(err)
	}
	actor := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, roles, created_at, updated_at,
		created_by_user_id, updated_by_user_id) VALUES ($1, 'a@example.com', 'A', 'x', '{admin}', now(), now(), $1, $1)`, actor); err != nil {
		t.Fatal(err)
	}
	items := make([]uuid.UUID, n)
	for i := range items {
		items[i] = uuid.New()
		if _, err := pool.Exec(ctx, `INSERT INTO catalogue_items (id, name, size_group, created_at, updated_at,
			created_by_user_id, updated_by_user_id) VALUES ($1, $2, 'NONE', now(), now(), $3, $3)`,
			items[i], "item-"+items[i].String(), actor); err != nil {
			t.Fatal(err)
		}
	}
	return pool, actor, items
}

// allKnown lets the repository's foreign key be the check under test.
type allKnown struct{}

func (allKnown) MissingItems(context.Context, []uuid.UUID) ([]uuid.UUID, error) { return nil, nil }

func TestPostgresItemSets(t *testing.T) {
	pool, actor, items := newTestPool(t, 3)
	svc := NewService(NewPostgresRepository(pool), allKnown{})
	ctx := context.Background()

	set, err := svc.Create(ctx, Params{Name: "Starter", Active: true, Lines: []LineParams{{items[2], 1}, {items[0], 3}}}, actor)
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.Get(ctx, set.ID)
	if err != nil || len(got.Lines) != 2 || got.Lines[0].CatalogueItemID != items[2] || got.Lines[1].DefaultQuantity != 3 {
		t.Fatalf("get = %+v, %v", got, err)
	}

	if _, err := svc.Update(ctx, set.ID, Params{Name: "Starter", Active: true, Lines: []LineParams{{items[1], 2}}}, actor); err != nil {
		t.Fatal(err)
	}
	got, _ = svc.Get(ctx, set.ID)
	if len(got.Lines) != 1 || got.Lines[0].CatalogueItemID != items[1] {
		t.Errorf("lines not replaced: %+v", got.Lines)
	}

	if _, err := svc.Create(ctx, Params{Name: "Bad", Lines: []LineParams{{uuid.New(), 1}}}, actor); !errors.Is(err, ErrUnknownItem) {
		t.Errorf("FK violation err = %v, want ErrUnknownItem", err)
	}
	if _, err := svc.Create(ctx, Params{Name: "STARTER", Lines: []LineParams{{items[0], 1}}}, actor); !errors.Is(err, ErrNameTaken) {
		t.Errorf("duplicate err = %v", err)
	}
	all, _ := svc.List(ctx)
	if len(all) != 1 {
		t.Errorf("list = %d", len(all))
	}
	if err := svc.Delete(ctx, set.ID, actor); err != nil {
		t.Fatal(err)
	}
	if active, _ := svc.ListActive(ctx); len(active) != 0 {
		t.Errorf("deleted set still active-listed")
	}
}
