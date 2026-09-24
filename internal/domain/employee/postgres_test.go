package employee

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newTestPool connects to API_TEST_DB_DSN (skipping when unset), empties the
// tables and inserts one user to act as the actor.
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

func countEvents(t *testing.T, pool *pgxpool.Pool, id uuid.UUID, event string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM audit_events WHERE entity_id = $1 AND event = $2`, id, event).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestPostgresEmployeeLifecycle(t *testing.T) {
	pool, actor := newTestPool(t)
	svc := NewService(NewPostgresRepository(pool))
	ctx := context.Background()

	e, err := svc.Create(ctx, Params{FirstName: "Jonas", LastName: "Petraitis", Code: sp2("W-1"), HeightCm: ip(181)}, actor)
	if err != nil {
		t.Fatal(err)
	}
	if countEvents(t, pool, e.ID, EventCreated) != 1 {
		t.Error("created event missing")
	}
	got, err := svc.Get(ctx, e.ID)
	if err != nil || got.Code == nil || *got.Code != "W-1" || *got.HeightCm != 181 || got.ClothingSize != nil {
		t.Fatalf("get = %+v, %v", got, err)
	}

	if _, err := svc.UpdateSizes(ctx, e.ID, SizesParams{HeightCm: ip(181), ClothingSize: sp2("L")}, actor); err != nil {
		t.Fatal(err)
	}
	if countEvents(t, pool, e.ID, EventSizesChanged) != 1 {
		t.Error("sizes_changed event missing")
	}

	res, err := svc.Search(ctx, "petr")
	if err != nil || len(res) != 1 {
		t.Errorf("search = %d, %v", len(res), err)
	}
	if res, _ := svc.Search(ctx, "%"); len(res) != 0 {
		t.Errorf("LIKE wildcard matched %d rows", len(res))
	}

	if _, err := svc.Create(ctx, Params{FirstName: "X", LastName: "Y", Code: sp2("w-1")}, actor); !errors.Is(err, ErrCodeTaken) {
		t.Errorf("duplicate code err = %v", err)
	}
	if err := svc.Delete(ctx, e.ID, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(ctx, e.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("get deleted err = %v", err)
	}
	if _, err := svc.Create(ctx, Params{FirstName: "X", LastName: "Y", Code: sp2("w-1")}, actor); err != nil {
		t.Errorf("code reuse after delete: %v", err)
	}
}

// TestPostgresFailedWriteRecordsNoEvent proves the event commits with the
// change: a write that fails leaves no audit row behind.
func TestPostgresFailedWriteRecordsNoEvent(t *testing.T) {
	pool, _ := newTestPool(t)
	svc := NewService(NewPostgresRepository(pool))
	ghost := uuid.New() // not a user: the actor FK fails
	id := uuid.New()
	svc.newID = func() uuid.UUID { return id }
	if _, err := svc.Create(context.Background(), Params{FirstName: "A", LastName: "B"}, ghost); !errors.Is(err, ErrActorNotFound) {
		t.Fatalf("err = %v, want ErrActorNotFound", err)
	}
	if countEvents(t, pool, id, EventCreated) != 0 {
		t.Error("audit row survived a failed write")
	}
}
