package role

import (
	"context"
	"errors"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newTestPool connects to API_TEST_DB_DSN (skipping without it), empties users
// (and so roles) and puts the built-in roles back.
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
	if _, err := pool.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users CASCADE`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	if err := EnsureBuiltins(ctx, pool); err != nil {
		t.Fatalf("built-in roles: %v", err)
	}
	return pool
}

// addUser inserts a user holding roles, attributed to itself.
func addUser(t *testing.T, pool *pgxpool.Pool, roles ...uuid.UUID) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	id := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, $2, 'U', 'h', now(), now(), $1, $1)`, id, id.String()+"@example.com"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO user_roles (user_id, role_id) SELECT $1, unnest($2::uuid[])`, id, roles); err != nil {
		t.Fatal(err)
	}
	return id
}

// The built-in roles the database holds are the ones in code, and putting
// them back leaves a changed one as it is.
func TestPostgresBuiltinsMatchCode(t *testing.T) {
	pool := newTestPool(t)
	svc := NewService(NewPostgresRepository(pool))
	ctx := context.Background()
	list, err := svc.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != len(builtinRoles) {
		t.Fatalf("roles = %+v, want the %d built-ins", list, len(builtinRoles))
	}
	for i, b := range builtinRoles {
		r := list[i]
		if r.ID != b.id || r.Key == nil || *r.Key != b.key || r.Name != b.name || r.Description != b.description || !slices.Equal(r.Permissions, builtins[b.key]) {
			t.Errorf("built-in %d = %+v, want %s with %v", i, r, b.key, builtins[b.key])
		}
		if r.Locked != (b.key == KeyAdmin) || r.CreatedByUserID != nil {
			t.Errorf("%s locked %v, created by %v", b.key, r.Locked, r.CreatedByUserID)
		}
	}
	admin := addUser(t, pool, AdminID)
	if _, err := svc.Update(ctx, EmployeeID, Params{Name: "Employee", Description: builtinRoles[2].description, Permissions: []string{"dashboard.employee", "orders.delete"}}, admin); err != nil {
		t.Fatal(err)
	}
	if err := EnsureBuiltins(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if r, _ := svc.Get(ctx, EmployeeID); !r.Grants(OrdersDelete) {
		t.Errorf("EnsureBuiltins reset a changed built-in: %v", r.Permissions)
	}
}

// The migration's built-ins are code's too: a fresh database (where
// EnsureBuiltins has nothing to add) holds the same permissions.
func TestPostgresMigrationBuiltins(t *testing.T) {
	pool := newTestPool(t)
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM role_permissions`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	want := 0
	for _, perms := range builtins {
		want += len(perms)
	}
	if n != want {
		t.Errorf("role_permissions rows = %d, want %d", n, want)
	}
}

func TestPostgresRoles(t *testing.T) {
	pool := newTestPool(t)
	svc := NewService(NewPostgresRepository(pool))
	ctx := context.Background()
	admin := addUser(t, pool, AdminID)

	r, err := svc.Create(ctx, Params{Name: "Storekeeper", Description: "Keeps the store", Permissions: []string{"orders.delete", "catalogue.manage"}}, admin)
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.Get(ctx, r.ID)
	if err != nil || got.Name != "Storekeeper" || !slices.Equal(got.Permissions, []Permission{CatalogueManage, OrdersDelete}) || got.UserCount != 0 || *got.CreatedByUserID != admin {
		t.Fatalf("round trip = %+v, %v", got, err)
	}
	if _, err := svc.Create(ctx, Params{Name: "STOREKEEPER"}, admin); !errors.Is(err, ErrNameTaken) {
		t.Errorf("same name: %v, want ErrNameTaken", err)
	}
	if _, err := svc.Create(ctx, Params{Name: "Ghost's"}, uuid.New()); !errors.Is(err, ErrActorNotFound) {
		t.Errorf("unknown actor: %v", err)
	}

	// Custom roles list after the built-ins; a holder counts.
	holder := addUser(t, pool, r.ID, EmployeeID)
	list, _ := svc.List(ctx)
	if n := len(builtinRoles); len(list) != n+1 || list[n].ID != r.ID || list[n].UserCount != 1 {
		t.Errorf("list = %+v", list)
	}
	if perms, _ := svc.PermissionsOf(ctx, holder); !slices.Equal(perms, []Permission{CatalogueManage, OrdersDelete, DashboardEmployee}) {
		t.Errorf("holder's permissions = %v", perms)
	}
	if err := svc.Delete(ctx, r.ID, admin); !errors.Is(err, ErrInUse) {
		t.Errorf("delete a held role: %v, want ErrInUse", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`, holder, r.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Update(ctx, r.ID, Params{Name: "Store", Permissions: []string{"catalogue.manage"}}, admin); err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete(ctx, r.ID, admin); err != nil {
		t.Fatal(err)
	}
	if missing, _ := svc.Missing(ctx, []uuid.UUID{r.ID, ManagerID}); !slices.Equal(missing, []uuid.UUID{r.ID}) {
		t.Errorf("missing = %v", missing)
	}
	if perms, _ := svc.Permissions(ctx, []uuid.UUID{r.ID, EmployeeID}); !slices.Equal(perms, []Permission{DashboardEmployee}) {
		t.Errorf("a deleted role grants %v", perms)
	}
	var events []string
	rows, _ := pool.Query(ctx, `SELECT event FROM audit_events WHERE entity_id = $1 ORDER BY occurred_at, event`, r.ID)
	for rows.Next() {
		var e string
		_ = rows.Scan(&e)
		events = append(events, e)
	}
	rows.Close()
	if !slices.Equal(events, []string{EventCreated, EventUpdated, EventDeleted}) {
		t.Errorf("audit = %v", events)
	}
	if err := svc.Delete(ctx, AdminID, admin); !errors.Is(err, ErrBuiltIn) {
		t.Errorf("delete Administrator: %v", err)
	}
}
