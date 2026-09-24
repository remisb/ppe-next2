package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/catalogue"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/itemset"
	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/domain/user"
)

// memRepo is a minimal in-memory user.Repository for exercising the HTTP layer.
// Domain behaviour is covered by the fake in internal/domain/user.
type memRepo struct {
	mu    sync.Mutex
	users map[uuid.UUID]user.User
}

func (m *memRepo) Create(_ context.Context, u user.User) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, x := range m.users {
		if x.DeletedAt == nil && strings.EqualFold(x.Email, u.Email) {
			return user.ErrEmailTaken
		}
	}
	m.users[u.ID] = u
	return nil
}

func (m *memRepo) Get(_ context.Context, id uuid.UUID) (user.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[id]
	if !ok || u.DeletedAt != nil {
		return user.User{}, user.ErrNotFound
	}
	return u, nil
}

func (m *memRepo) ByEmail(_ context.Context, email string) (user.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range m.users {
		if u.DeletedAt == nil && strings.EqualFold(u.Email, email) {
			return u, nil
		}
	}
	return user.User{}, user.ErrNotFound
}

func (m *memRepo) List(_ context.Context) ([]user.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]user.User, 0)
	for _, u := range m.users {
		if u.DeletedAt == nil {
			out = append(out, u)
		}
	}
	return out, nil
}

func (m *memRepo) Update(_ context.Context, u user.User) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if x, ok := m.users[u.ID]; !ok || x.DeletedAt != nil {
		return user.ErrNotFound
	}
	m.users[u.ID] = u
	return nil
}

func (m *memRepo) SetPasswordHash(_ context.Context, id uuid.UUID, hash string, at time.Time, by uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[id]
	if !ok || u.DeletedAt != nil {
		return user.ErrNotFound
	}
	u.PasswordHash, u.UpdatedAt, u.UpdatedByUserID = hash, at, by
	m.users[id] = u
	return nil
}

func (m *memRepo) Delete(_ context.Context, id uuid.UUID, at time.Time, by uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[id]
	if !ok || u.DeletedAt != nil {
		return user.ErrNotFound
	}
	u.DeletedAt, u.DeletedByUserID = &at, &by
	m.users[id] = u
	return nil
}

// stubEmployees and stubCatalogue satisfy their repositories for tests that
// only exercise routing and authorization: reads find nothing, writes succeed.
type stubEmployees struct{}

func (stubEmployees) Create(context.Context, employee.Employee, *audit.Event) error { return nil }
func (stubEmployees) Get(context.Context, uuid.UUID) (employee.Employee, error) {
	return employee.Employee{}, employee.ErrNotFound
}
func (stubEmployees) List(context.Context) ([]employee.Employee, error) {
	return []employee.Employee{}, nil
}
func (stubEmployees) SearchByName(context.Context, string, int) ([]employee.Employee, error) {
	return []employee.Employee{}, nil
}
func (stubEmployees) Update(context.Context, uuid.UUID, employee.Mutation) (employee.Employee, error) {
	return employee.Employee{}, employee.ErrNotFound
}

type stubCatalogue struct{}

func (stubCatalogue) Create(context.Context, catalogue.Item, *audit.Event) error { return nil }
func (stubCatalogue) Get(context.Context, uuid.UUID) (catalogue.Item, error) {
	return catalogue.Item{}, catalogue.ErrNotFound
}
func (stubCatalogue) List(context.Context) ([]catalogue.Item, error) { return []catalogue.Item{}, nil }
func (stubCatalogue) ListActive(context.Context) ([]catalogue.Item, error) {
	return []catalogue.Item{}, nil
}
func (stubCatalogue) Update(context.Context, uuid.UUID, catalogue.Mutation) (catalogue.Item, error) {
	return catalogue.Item{}, catalogue.ErrNotFound
}

type stubItemSets struct{}

func (stubItemSets) Create(context.Context, itemset.ItemSet) error { return nil }
func (stubItemSets) Get(context.Context, uuid.UUID) (itemset.ItemSet, error) {
	return itemset.ItemSet{}, itemset.ErrNotFound
}
func (stubItemSets) List(context.Context) ([]itemset.ItemSet, error) { return []itemset.ItemSet{}, nil }
func (stubItemSets) ListActive(context.Context) ([]itemset.ItemSet, error) {
	return []itemset.ItemSet{}, nil
}
func (stubItemSets) Update(context.Context, itemset.ItemSet) error { return itemset.ErrNotFound }
func (stubItemSets) Delete(context.Context, itemset.ItemSet) error { return itemset.ErrNotFound }

type stubOrders struct{}

func (stubOrders) Create(context.Context, uuid.UUID, []uuid.UUID, uuid.UUID, order.Build) (order.Order, error) {
	return order.Order{}, order.ErrEmployeeNotFound
}
func (stubOrders) Get(context.Context, uuid.UUID) (order.Order, error) {
	return order.Order{}, order.ErrNotFound
}
func (stubOrders) List(context.Context, order.ListFilter) ([]order.Order, int, error) {
	return []order.Order{}, 0, nil
}
func (stubOrders) CreateLink(context.Context, uuid.UUID, order.LinkFunc) error {
	return order.ErrNotFound
}
func (stubOrders) LinkByHash(context.Context, string) (order.Confirmation, error) {
	return order.Confirmation{}, order.ErrLinkExpired
}
func (stubOrders) Confirm(context.Context, uuid.UUID, *uuid.UUID, uuid.UUID, order.ConfirmFunc) (order.Order, error) {
	return order.Order{}, order.ErrNotFound
}
func (stubOrders) ConfirmedFor(context.Context, uuid.UUID) (order.Confirmation, error) {
	return order.Confirmation{}, order.ErrNotFound
}

var testLogger = slog.New(slog.NewTextHandler(io.Discard, nil))

func testConfig() config {
	return config{LoginRateLimit: 100, LoginRateInterval: time.Minute, RequestTimeout: 5 * time.Second, OrgTimezone: "Europe/Vilnius", PublicBaseURL: "https://work.example.com"}
}

type testAPI struct {
	handler http.Handler
	svc     services
	tokens  *tokens
	admin   user.User
}

func newTestAPI(t *testing.T) *testAPI {
	t.Helper()
	users := user.NewService(&memRepo{users: map[uuid.UUID]user.User{}},
		user.WithHasher(func(p string) (string, error) { return "h:" + p, nil }, func(h, p string) bool { return h == "h:"+p }))
	admin, err := users.Bootstrap(context.Background(), "admin@example.com", "Admin", "password123")
	if err != nil {
		t.Fatal(err)
	}
	svc := newServices(time.UTC, time.Hour, users, stubEmployees{}, stubCatalogue{}, stubItemSets{}, stubOrders{})
	tok := testTokens(time.Now())
	return &testAPI{handler: routes(testConfig(), svc, tok, testLogger), svc: svc, tokens: tok, admin: admin}
}

func (a *testAPI) userWith(t *testing.T, roles ...string) (user.User, string) {
	t.Helper()
	u, err := a.svc.users.Create(context.Background(), user.CreateParams{
		Email: uuid.NewString()[:8] + "@example.com", Name: "U", Password: "password123", Roles: roles,
	}, a.admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	tok, _, err := a.tokens.issue(u)
	if err != nil {
		t.Fatal(err)
	}
	return u, tok
}

func (a *testAPI) do(t *testing.T, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, r)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	a.handler.ServeHTTP(rec, req)
	return rec
}

// policy pins who may call every route. Changing a route's access, or adding
// a route, must change this table: TestRoutePolicy fails otherwise.
var policy = map[string]string{
	"GET /health":             "public",
	"POST /api/v1/auth/login": "public",

	"GET /api/v1/users/me":               "any",
	"PUT /api/v1/users/me/password":      "any",
	"GET /api/v1/users":                  "managers",
	"GET /api/v1/users/{id}":             "managers",
	"GET /api/v1/users/by-email/{email}": "managers",
	"POST /api/v1/users":                 "admins",
	"PUT /api/v1/users/{id}":             "admins",
	"PUT /api/v1/users/{id}/password":    "admins",
	"DELETE /api/v1/users/{id}":          "admins",

	"GET /api/v1/employees":             "any",
	"GET /api/v1/employees/{id}":        "any",
	"GET /api/v1/employees/by-name/{q}": "any",
	"POST /api/v1/employees":            "any",
	"PUT /api/v1/employees/{id}":        "any",
	"PUT /api/v1/employees/{id}/sizes":  "any",
	"DELETE /api/v1/employees/{id}":     "managers",

	"GET /api/v1/catalogue":                  "any",
	"GET /api/v1/catalogue/active":           "any",
	"GET /api/v1/catalogue/{id}":             "any",
	"POST /api/v1/catalogue":                 "managers",
	"PUT /api/v1/catalogue/{id}":             "managers",
	"POST /api/v1/catalogue/{id}/activate":   "managers",
	"POST /api/v1/catalogue/{id}/deactivate": "managers",
	"DELETE /api/v1/catalogue/{id}":          "managers",

	"GET /api/v1/item-sets":                         "any",
	"GET /api/v1/item-sets/active":                  "any",
	"GET /api/v1/item-sets/{id}":                    "any",
	"POST /api/v1/item-sets":                        "managers",
	"PUT /api/v1/item-sets/{id}":                    "managers",
	"DELETE /api/v1/item-sets/{id}":                 "managers",
	"GET /api/v1/item-sets/{id}/apply/{employeeID}": "any",
	"GET /api/v1/sizes":                             "any",
	"POST /api/v1/orders/resolve":                   "any",
	"POST /api/v1/orders":                           "any",
	"GET /api/v1/orders":                            "any",
	"GET /api/v1/settings":                          "any",
	"POST /api/v1/orders/{id}/confirmation-link":    "any",
	"POST /api/v1/orders/{id}/confirm-paper":        "any",
	"GET /api/v1/orders/{id}/record":                "any",
	"POST /api/v1/confirmations/view":               "public",
	"POST /api/v1/confirmations/confirm":            "public",
	"GET /api/v1/orders/{id}":                       "any",
}

var allowedRoles = map[string][]string{
	"any":      {user.RoleAdmin, user.RoleManager, user.RoleEmployee},
	"managers": {user.RoleAdmin, user.RoleManager},
	"admins":   {user.RoleAdmin},
}

var wildcard = regexp.MustCompile(`\{[^}]+\}`)

func TestRoutePolicy(t *testing.T) {
	api := newTestAPI(t)
	tokens := map[string]string{}
	for _, role := range user.KnownRoles() {
		_, tokens[role] = api.userWith(t, role)
	}

	rt := buildRouter(testConfig(), api.svc, api.tokens)
	registered := map[string]bool{}
	for _, r := range rt.routes {
		registered[r.pattern] = true
		want, ok := policy[r.pattern]
		if !ok {
			t.Errorf("route %q has no entry in the policy table", r.pattern)
			continue
		}
		got := "any"
		switch {
		case r.access.public:
			got = "public"
		case r.access.roles != nil:
			got = strings.Join(r.access.roles, ",")
			want = strings.Join(allowedRoles[want], ",")
		}
		if got != want {
			t.Errorf("%s: registered access %q, policy says %q", r.pattern, got, want)
		}
	}
	for pattern := range policy {
		if !registered[pattern] {
			t.Errorf("policy entry %q matches no registered route", pattern)
		}
	}

	// Behaviour: no token is 401; a role outside the policy is 403; an allowed
	// role gets past authorization (any status but 401/403).
	for pattern, rule := range policy {
		if rule == "public" {
			continue
		}
		method, path, _ := strings.Cut(pattern, " ")
		path = wildcard.ReplaceAllString(path, uuid.NewString())
		var body any
		if method == http.MethodPost || method == http.MethodPut {
			body = map[string]any{}
		}
		t.Run(pattern, func(t *testing.T) {
			if code := api.do(t, method, path, "", body).Code; code != http.StatusUnauthorized {
				t.Errorf("no token: %d, want 401", code)
			}
			for _, role := range user.KnownRoles() {
				code := api.do(t, method, path, tokens[role], body).Code
				allowed := slices.Contains(allowedRoles[rule], role)
				switch {
				case allowed && (code == http.StatusUnauthorized || code == http.StatusForbidden):
					t.Errorf("%s: %d, want access", role, code)
				case !allowed && code != http.StatusForbidden:
					t.Errorf("%s: %d, want 403", role, code)
				}
			}
		})
	}
}

func TestLoginFlow(t *testing.T) {
	api := newTestAPI(t)

	rec := api.do(t, "POST", "/api/v1/auth/login", "", map[string]string{"email": "ADMIN@example.com", "password": "password123"})
	if rec.Code != http.StatusOK {
		t.Fatalf("login status = %d: %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Error("login response must not be cached")
	}
	var resp struct {
		AccessToken string          `json:"access_token"`
		TokenType   string          `json:"token_type"`
		User        json.RawMessage `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.TokenType != "Bearer" || resp.AccessToken == "" {
		t.Fatalf("login response = %s", rec.Body)
	}
	if strings.Contains(string(resp.User), "password") || strings.Contains(string(resp.User), "h:") {
		t.Errorf("user JSON leaks the password hash: %s", resp.User)
	}

	if rec := api.do(t, "GET", "/api/v1/users/me", resp.AccessToken, nil); rec.Code != http.StatusOK {
		t.Errorf("me with issued token = %d", rec.Code)
	}
	if rec := api.do(t, "POST", "/api/v1/auth/login", "", map[string]string{"email": "admin@example.com", "password": "wrong-pass"}); rec.Code != http.StatusUnauthorized {
		t.Errorf("wrong password = %d, want 401", rec.Code)
	}
	if rec := api.do(t, "POST", "/api/v1/auth/login", "", map[string]any{"email": "admin@example.com", "password": "password123", "role": "admin"}); rec.Code != http.StatusBadRequest {
		t.Errorf("unknown field = %d, want 400", rec.Code)
	}
}

func TestLoginRateLimited(t *testing.T) {
	api := newTestAPI(t)
	cfg := config{LoginRateLimit: 2, LoginRateInterval: time.Minute, RequestTimeout: 5 * time.Second}
	api.handler = routes(cfg, api.svc, api.tokens, testLogger)
	var last int
	for range 3 {
		last = api.do(t, "POST", "/api/v1/auth/login", "", map[string]string{"email": "x@example.com", "password": "password123"}).Code
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("third attempt = %d, want 429", last)
	}
}

func TestDeletedUserTokenIsUnauthenticated(t *testing.T) {
	api := newTestAPI(t)
	u, tok := api.userWith(t, user.RoleEmployee)
	if err := api.svc.users.Delete(context.Background(), u.ID, api.admin.ID); err != nil {
		t.Fatal(err)
	}
	if rec := api.do(t, "GET", "/api/v1/users/me", tok, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("me for deleted user = %d, want 401", rec.Code)
	}
}

func TestHealthIsOpen(t *testing.T) {
	api := newTestAPI(t)
	if rec := api.do(t, "GET", "/health", "", nil); rec.Code != http.StatusOK {
		t.Fatalf("health = %d", rec.Code)
	}
}
