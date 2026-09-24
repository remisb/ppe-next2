package user

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newTestPool connects to API_TEST_DB_DSN, skipping when it is unset so
// `go test ./...` passes without a database. It empties users first.
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
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE users CASCADE`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return pool
}

func newPostgresService(t *testing.T) (*Service, User) {
	t.Helper()
	svc := NewService(NewPostgresRepository(newTestPool(t)), WithHasher(fakeHash, fakeVerify))
	admin, err := svc.Bootstrap(context.Background(), "admin@example.com", "Admin", "password123")
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	return svc, admin
}

func TestPostgresRoundTrip(t *testing.T) {
	svc, admin := newPostgresService(t)
	ctx := context.Background()

	u, err := svc.Create(ctx, CreateParams{Email: "Emp@Example.com", Name: "Emp", Password: "password123", Roles: []string{RoleEmployee, RoleManager}}, admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.ByEmail(ctx, "EMP@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != u.ID || len(got.Roles) != 2 || got.PasswordHash != "hash:password123" || got.CreatedByUserID != admin.ID {
		t.Errorf("round trip = %+v", got)
	}
	list, err := svc.List(ctx)
	if err != nil || len(list) != 2 {
		t.Errorf("list = %d users, %v", len(list), err)
	}
}

func TestPostgresUniqueEmailAmongLiveRows(t *testing.T) {
	svc, admin := newPostgresService(t)
	ctx := context.Background()
	p := CreateParams{Email: "dup@example.com", Name: "Dup", Password: "password123", Roles: []string{RoleEmployee}}

	first, err := svc.Create(ctx, p, admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	p.Email = "DUP@example.com"
	if _, err := svc.Create(ctx, p, admin.ID); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("duplicate err = %v, want ErrEmailTaken", err)
	}
	if err := svc.Delete(ctx, first.ID, admin.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete(ctx, first.ID, admin.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete err = %v, want ErrNotFound", err)
	}
	if _, err := svc.Get(ctx, first.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("get deleted err = %v, want ErrNotFound", err)
	}
	if _, err := svc.Create(ctx, p, admin.ID); err != nil {
		t.Errorf("reuse after delete: %v", err)
	}
}

func TestPostgresUnknownActor(t *testing.T) {
	svc, _ := newPostgresService(t)
	_, err := svc.Create(context.Background(), CreateParams{Email: "x@example.com", Name: "X", Password: "password123", Roles: []string{RoleEmployee}}, uuid.New())
	if !errors.Is(err, ErrActorNotFound) {
		t.Fatalf("err = %v, want ErrActorNotFound", err)
	}
}

func TestPostgresUpdateAndPassword(t *testing.T) {
	svc, admin := newPostgresService(t)
	ctx := context.Background()
	u, _ := svc.Create(ctx, CreateParams{Email: "u@example.com", Name: "U", Password: "password123", Roles: []string{RoleEmployee}}, admin.ID)

	upd, err := svc.Update(ctx, u.ID, UpdateParams{Email: "u2@example.com", Name: "U2", Roles: []string{RoleManager}, IsActive: false}, admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := svc.Get(ctx, u.ID)
	if got.Email != "u2@example.com" || got.IsActive || got.Roles[0] != RoleManager || got.UpdatedByUserID != admin.ID || !got.UpdatedAt.Equal(upd.UpdatedAt) {
		t.Errorf("after update = %+v", got)
	}
	if err := svc.SetPassword(ctx, u.ID, "password999", admin.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = svc.Get(ctx, u.ID)
	if got.PasswordHash != "hash:password999" {
		t.Errorf("hash = %q", got.PasswordHash)
	}
	if _, err := svc.Update(ctx, uuid.New(), UpdateParams{Email: "n@example.com", Name: "N", Roles: []string{RoleEmployee}, IsActive: true}, admin.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("update unknown err = %v", err)
	}
}
