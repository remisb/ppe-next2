package role

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// fakeRepo holds roles and who holds them, as the Postgres repository does.
type fakeRepo struct {
	mu      sync.Mutex
	roles   map[uuid.UUID]Role
	holders map[uuid.UUID][]uuid.UUID // user → roles
	events  []audit.Event
}

func newFakeRepo() *fakeRepo {
	f := &fakeRepo{roles: map[uuid.UUID]Role{}, holders: map[uuid.UUID][]uuid.UUID{}}
	for _, b := range builtinRoles {
		key := b.key
		f.roles[b.id] = Role{ID: b.id, Key: &key, Name: b.name, Description: b.description, Permissions: builtins[b.key], Locked: b.key == KeyAdmin}
	}
	return f
}

func (f *fakeRepo) withCount(r Role) Role {
	r.UserCount = 0
	for _, held := range f.holders {
		if slices.Contains(held, r.ID) {
			r.UserCount++
		}
	}
	return r
}

func (f *fakeRepo) Create(_ context.Context, r Role, ev *audit.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, x := range f.roles {
		if !x.Deleted() && strings.EqualFold(x.Name, r.Name) {
			return ErrNameTaken
		}
	}
	f.roles[r.ID] = r
	if ev != nil {
		f.events = append(f.events, *ev)
	}
	return nil
}

func (f *fakeRepo) Get(_ context.Context, id uuid.UUID) (Role, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.roles[id]
	if !ok || r.Deleted() {
		return Role{}, ErrNotFound
	}
	return f.withCount(r), nil
}

func (f *fakeRepo) List(context.Context) ([]Role, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Role, 0)
	for _, r := range f.roles {
		if !r.Deleted() {
			out = append(out, f.withCount(r))
		}
	}
	return out, nil
}

func (f *fakeRepo) Update(_ context.Context, id uuid.UUID, m Mutation) (Role, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.roles[id]
	if !ok || cur.Deleted() {
		return Role{}, ErrNotFound
	}
	next, ev, err := m(f.withCount(cur))
	if err != nil {
		return Role{}, err
	}
	f.roles[id] = next
	if ev != nil {
		f.events = append(f.events, *ev)
	}
	return next, nil
}

func (f *fakeRepo) Permissions(_ context.Context, ids []uuid.UUID) ([]Permission, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var all []string
	for _, id := range ids {
		if r, ok := f.roles[id]; ok && !r.Deleted() {
			all = append(all, Strings(r.Permissions)...)
		}
	}
	return Known(all), nil
}

func (f *fakeRepo) OfUser(_ context.Context, userID uuid.UUID) ([]Role, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []Role
	for _, id := range f.holders[userID] {
		if r, ok := f.roles[id]; ok && !r.Deleted() {
			out = append(out, r)
		}
	}
	return out, nil
}

func (f *fakeRepo) Missing(_ context.Context, ids []uuid.UUID) ([]uuid.UUID, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []uuid.UUID
	for _, id := range ids {
		if r, ok := f.roles[id]; !ok || r.Deleted() {
			out = append(out, id)
		}
	}
	return out, nil
}

var testNow = time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)

// newTestService has an administrator and a user who manages users and nothing else.
func newTestService(t *testing.T) (svc *Service, repo *fakeRepo, admin, hr uuid.UUID) {
	t.Helper()
	repo = newFakeRepo()
	svc = NewService(repo, WithClock(func() time.Time { return testNow }))
	admin, hr = uuid.New(), uuid.New()
	repo.holders[admin] = []uuid.UUID{AdminID}
	r, err := svc.Create(context.Background(), Params{Name: "People", Permissions: []string{"users.read", "users.manage"}}, admin)
	if err != nil {
		t.Fatal(err)
	}
	repo.holders[hr] = []uuid.UUID{r.ID}
	repo.events = nil
	return svc, repo, admin, hr
}

func TestParamsValidate(t *testing.T) {
	tests := []struct {
		name string
		p    Params
		want string
	}{
		{"ok, trimmed, in catalogue order", Params{Name: " Storekeeper ", Permissions: []string{"orders.delete", " catalogue.manage", "orders.delete"}}, ""},
		{"no permissions is allowed", Params{Name: "Nothing yet"}, ""},
		{"no name", Params{Name: " "}, "name is required"},
		{"long name", Params{Name: strings.Repeat("x", 101)}, "name is too long"},
		{"long description", Params{Name: "R", Description: strings.Repeat("x", 501)}, "description is too long"},
		{"unknown permission", Params{Name: "R", Permissions: []string{"orders.everything"}}, "unknown permission orders.everything"},
		{"a requirement left out", Params{Name: "R", Permissions: []string{"roles.manage"}}, "roles.manage needs users.read"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			perms, err := tt.p.Validate()
			if tt.want == "" {
				if err != nil {
					t.Fatal(err)
				}
				if tt.p.Name == "Storekeeper" && !slices.Equal(perms, []Permission{CatalogueManage, OrdersDelete}) {
					t.Errorf("permissions = %v", perms)
				}
				return
			}
			if !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), tt.want) {
				t.Errorf("err = %v, want ErrInvalid with %q", err, tt.want)
			}
		})
	}
}

func TestCreateAndAudit(t *testing.T) {
	svc, repo, admin, hr := newTestService(t)
	ctx := context.Background()
	r, err := svc.Create(ctx, Params{Name: "Storekeeper", Description: "Keeps the store", Permissions: []string{"catalogue.manage"}}, admin)
	if err != nil {
		t.Fatal(err)
	}
	if r.Builtin() || r.Locked || *r.CreatedByUserID != admin || !r.CreatedAt.Equal(testNow) {
		t.Errorf("role = %+v", r)
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventCreated || repo.events[0].EntityID != r.ID {
		t.Errorf("events = %+v", repo.events)
	}
	if _, err := svc.Create(ctx, Params{Name: "storekeeper"}, admin); !errors.Is(err, ErrNameTaken) {
		t.Errorf("same name: %v, want ErrNameTaken", err)
	}
	// Who does not manage roles grants only what they hold.
	if _, err := svc.Create(ctx, Params{Name: "Deleter", Permissions: []string{"orders.delete"}}, hr); !errors.Is(err, ErrNotPermitted) {
		t.Errorf("grant a permission not held: %v, want ErrNotPermitted", err)
	}
	if _, err := svc.Create(ctx, Params{Name: "R"}, uuid.Nil); !errors.Is(err, ErrInvalid) {
		t.Errorf("no actor: %v", err)
	}
}

func TestBuiltinRules(t *testing.T) {
	svc, _, admin, _ := newTestService(t)
	ctx := context.Background()
	if _, err := svc.Update(ctx, AdminID, Params{Name: "Administrator"}, admin); !errors.Is(err, ErrBuiltIn) {
		t.Errorf("change Administrator: %v, want ErrBuiltIn", err)
	}
	if err := svc.Delete(ctx, AdminID, admin); !errors.Is(err, ErrBuiltIn) {
		t.Errorf("delete Administrator: %v, want ErrBuiltIn", err)
	}
	if _, err := svc.Update(ctx, ManagerID, Params{Name: "Boss", Permissions: []string{"orders.delete"}}, admin); !errors.Is(err, ErrInvalid) {
		t.Errorf("rename Manager: %v, want ErrInvalid", err)
	}
	m, err := svc.Update(ctx, ManagerID, Params{Name: "Manager", Description: "Runs the store", Permissions: []string{"orders.delete", "dashboard.manager"}}, admin)
	if err != nil || !slices.Equal(m.Permissions, []Permission{OrdersDelete, DashboardManager}) || m.Description != "Runs the store" {
		t.Errorf("change Manager's permissions = %+v, %v", m, err)
	}
	if err := svc.Delete(ctx, EmployeeID, admin); !errors.Is(err, ErrInvalid) {
		t.Errorf("delete Employee: %v, want ErrInvalid", err)
	}
}

func TestUpdateRules(t *testing.T) {
	svc, repo, admin, hr := newTestService(t)
	ctx := context.Background()
	people := repo.holders[hr][0]
	// hr cannot add a permission they do not hold to their own role, nor take
	// users.manage from themselves.
	if _, err := svc.Update(ctx, people, Params{Name: "People", Permissions: []string{"users.read", "users.manage", "orders.delete"}}, hr); !errors.Is(err, ErrNotPermitted) {
		t.Errorf("add orders.delete: %v, want ErrNotPermitted", err)
	}
	if _, err := svc.Update(ctx, people, Params{Name: "People", Permissions: []string{"users.read"}}, hr); !errors.Is(err, ErrInvalid) {
		t.Errorf("drop own users.manage: %v, want ErrInvalid", err)
	}
	// Unchanged: no event. Renamed: role.updated with before and after.
	if _, err := svc.Update(ctx, people, Params{Name: "People", Permissions: []string{"users.manage", "users.read"}}, admin); err != nil || len(repo.events) != 0 {
		t.Errorf("unchanged update: %v, events %d", err, len(repo.events))
	}
	if _, err := svc.Update(ctx, people, Params{Name: "Personnel", Permissions: []string{"users.read", "users.manage"}}, admin); err != nil {
		t.Fatal(err)
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventUpdated || !strings.Contains(string(repo.events[0].Before), `"People"`) {
		t.Errorf("events = %+v", repo.events)
	}
}

func TestDeleteRules(t *testing.T) {
	svc, repo, admin, hr := newTestService(t)
	ctx := context.Background()
	people := repo.holders[hr][0]
	if err := svc.Delete(ctx, people, admin); !errors.Is(err, ErrInUse) {
		t.Errorf("delete a role a user holds: %v, want ErrInUse", err)
	}
	r, _ := svc.Create(ctx, Params{Name: "Spare"}, admin)
	if err := svc.Delete(ctx, r.ID, admin); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(ctx, r.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("get deleted: %v", err)
	}
	if err := svc.Delete(ctx, r.ID, admin); !errors.Is(err, ErrNotFound) {
		t.Errorf("delete twice: %v", err)
	}
	if missing, _ := svc.Missing(ctx, []uuid.UUID{r.ID, AdminID}); !slices.Equal(missing, []uuid.UUID{r.ID}) {
		t.Errorf("missing = %v", missing)
	}
	// A deleted role's name is free again.
	if _, err := svc.Create(ctx, Params{Name: "Spare"}, admin); err != nil {
		t.Errorf("reuse a deleted role's name: %v", err)
	}
}

func TestPermissionsOf(t *testing.T) {
	svc, _, admin, hr := newTestService(t)
	ctx := context.Background()
	got, err := svc.PermissionsOf(ctx, admin)
	if err != nil || !slices.Equal(got, BuiltinPermissions([]string{KeyAdmin})) {
		t.Errorf("administrator's = %v, %v", got, err)
	}
	if got, _ := svc.PermissionsOf(ctx, hr); !slices.Equal(got, []Permission{UsersRead, UsersManage}) {
		t.Errorf("hr's = %v", got)
	}
	if got, _ := svc.PermissionsOf(ctx, uuid.New()); len(got) != 0 {
		t.Errorf("nobody's = %v", got)
	}
}
