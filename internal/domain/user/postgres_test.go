package user

import (
	"context"
	"errors"
	"os"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/domain/role"
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
	// The truncation reaches roles through their actor keys.
	if err := role.EnsureBuiltins(ctx, pool); err != nil {
		t.Fatalf("built-in roles: %v", err)
	}
	return pool
}

func newPostgresService(t *testing.T) (*Service, User) {
	t.Helper()
	svc, admin, _ := newPostgresServiceAndPool(t)
	return svc, admin
}

func newPostgresServiceAndPool(t *testing.T) (*Service, User, *pgxpool.Pool) {
	t.Helper()
	pool := newTestPool(t)
	roles := role.NewService(role.NewPostgresRepository(pool))
	svc := NewService(NewPostgresRepository(pool), WithHasher(fakeHash, fakeVerify), WithRoles(roles), WithGuardRole(role.AdminID))
	admin, err := svc.Bootstrap(context.Background(), "admin@example.com", "Admin", "password123", adminRoles)
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	return svc, admin, pool
}

func TestPostgresRoundTrip(t *testing.T) {
	svc, admin := newPostgresService(t)
	ctx := context.Background()

	u, err := svc.Create(ctx, CreateParams{Email: "Emp@Example.com", Name: "Emp", Password: "password123", RoleIDs: []uuid.UUID{role.EmployeeID, role.ManagerID}}, admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.ByEmail(ctx, "EMP@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != u.ID || !slices.Equal(got.RoleIDs, []uuid.UUID{role.ManagerID, role.EmployeeID}) || got.PasswordHash != "hash:password123" || got.CreatedByUserID != admin.ID {
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
	p := CreateParams{Email: "dup@example.com", Name: "Dup", Password: "password123", RoleIDs: employeeRoles}

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

// The repository turns an actor key naming no user into ErrActorNotFound.
func TestPostgresUnknownActor(t *testing.T) {
	repo := NewPostgresRepository(newTestPool(t))
	now := time.Now().UTC()
	err := repo.Create(context.Background(), User{
		ID: uuid.New(), Email: "x@example.com", Name: "X", PasswordHash: "h", RoleIDs: employeeRoles, IsActive: true,
		Language: LangEnglish, CreatedAt: now, UpdatedAt: now, CreatedByUserID: uuid.New(), UpdatedByUserID: uuid.New(),
	})
	if !errors.Is(err, ErrActorNotFound) {
		t.Fatalf("err = %v, want ErrActorNotFound", err)
	}
}

func TestPostgresUpdateAndPassword(t *testing.T) {
	svc, admin := newPostgresService(t)
	ctx := context.Background()
	u, _ := svc.Create(ctx, CreateParams{Email: "u@example.com", Name: "U", Password: "password123", RoleIDs: employeeRoles}, admin.ID)

	upd, err := svc.Update(ctx, u.ID, UpdateParams{Email: "u2@example.com", Name: "U2", RoleIDs: managerRoles, IsActive: false}, admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := svc.Get(ctx, u.ID)
	if got.Email != "u2@example.com" || got.IsActive || !slices.Equal(got.RoleIDs, managerRoles) || got.UpdatedByUserID != admin.ID || !got.UpdatedAt.Equal(upd.UpdatedAt) {
		t.Errorf("after update = %+v", got)
	}
	if err := svc.SetPassword(ctx, u.ID, "password999", admin.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = svc.Get(ctx, u.ID)
	if got.PasswordHash != "hash:password999" {
		t.Errorf("hash = %q", got.PasswordHash)
	}
	if _, err := svc.Update(ctx, uuid.New(), UpdateParams{Email: "n@example.com", Name: "N", RoleIDs: employeeRoles, IsActive: true}, admin.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("update unknown err = %v", err)
	}
}

func TestPostgresLanguage(t *testing.T) {
	svc, admin := newPostgresService(t)
	ctx := context.Background()
	if admin.Language != LangEnglish {
		t.Errorf("new account language = %q, want en", admin.Language)
	}
	if _, err := svc.SetLanguage(ctx, admin.ID, LangRussian); err != nil {
		t.Fatal(err)
	}
	u, err := svc.Authenticate(ctx, admin.Email, "password123")
	if err != nil || u.Language != LangRussian {
		t.Errorf("signed in as %+v, %v; want language ru", u, err)
	}
}

// Two administrators demoting each other at once: the guard serialises them,
// so one succeeds and the other is ErrLastAdministrator. A role change is
// audited in the same transaction.
func TestPostgresLastAdministratorUnderConcurrency(t *testing.T) {
	svc, admin, pool := newPostgresServiceAndPool(t)
	ctx := context.Background()
	other, err := svc.Create(ctx, CreateParams{Email: "a2@example.com", Name: "A2", Password: "password123", RoleIDs: adminRoles}, admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	demote := func(target User, actor uuid.UUID) error {
		_, err := svc.Update(ctx, target.ID, UpdateParams{Email: target.Email, Name: target.Name, RoleIDs: employeeRoles, IsActive: true}, actor)
		return err
	}
	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)
	go func() { defer wg.Done(); errs[0] = demote(other, admin.ID) }()
	go func() { defer wg.Done(); errs[1] = demote(admin, other.ID) }()
	wg.Wait()
	ok, last := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, ErrLastAdministrator), errors.Is(err, ErrNotPermitted):
			last++
		default:
			t.Errorf("unexpected error %v", err)
		}
	}
	if ok != 1 || last != 1 {
		t.Fatalf("results %v: want one demotion and one refusal", errs)
	}
	var admins, events int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM user_roles ur JOIN users u ON u.id = ur.user_id
		WHERE ur.role_id = $1 AND u.is_active AND u.deleted_at IS NULL`, role.AdminID).Scan(&admins); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE event = $1`, EventRolesChanged).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if admins != 1 || events != 1 {
		t.Errorf("administrators left %d, roles_changed events %d; want 1 and 1", admins, events)
	}
}

func TestPostgresUnknownRole(t *testing.T) {
	svc, admin := newPostgresService(t)
	_, err := svc.Create(context.Background(), CreateParams{Email: "x@example.com", Name: "X", Password: "password123", RoleIDs: []uuid.UUID{uuid.New()}}, admin.ID)
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}
