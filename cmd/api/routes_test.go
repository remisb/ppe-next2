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
	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/asset"
	"github.com/remisb/ppe-next2/internal/domain/backup"
	"github.com/remisb/ppe-next2/internal/domain/catalogue"
	"github.com/remisb/ppe-next2/internal/domain/dashboard"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/itemset"
	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/session"
	"github.com/remisb/ppe-next2/internal/domain/settings"
	"github.com/remisb/ppe-next2/internal/domain/user"
	"github.com/remisb/ppe-next2/internal/security"
	"github.com/remisb/ppe-next2/internal/system"
	"github.com/remisb/ppe-next2/internal/usage"
)

// memRepo is a minimal in-memory user.Repository for exercising the HTTP layer.
// Domain behaviour is covered by the fake in internal/domain/user.
type memRepo struct {
	mu    sync.Mutex
	users map[uuid.UUID]user.User
}

func (m *memRepo) Create(_ context.Context, u user.User, _ audit.Event) error {
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

func (m *memRepo) Update(_ context.Context, u user.User, _ uuid.UUID, _ []audit.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if x, ok := m.users[u.ID]; !ok || x.DeletedAt != nil {
		return user.ErrNotFound
	}
	m.users[u.ID] = u
	return nil
}

// holding counts the live users who hold role id.
func (m *memRepo) holding(id uuid.UUID) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, u := range m.users {
		if u.DeletedAt == nil && slices.Contains(u.RoleIDs, id) {
			n++
		}
	}
	return n
}

// roleIDs are the roles user id holds.
func (m *memRepo) roleIDs(id uuid.UUID) []uuid.UUID {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.users[id].RoleIDs
}

func (m *memRepo) SetPasswordHash(_ context.Context, id uuid.UUID, hash string, at time.Time, by uuid.UUID, _ audit.Event) error {
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

func (m *memRepo) SetLanguage(_ context.Context, id uuid.UUID, lang string, at time.Time, by uuid.UUID, _ audit.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[id]
	if !ok || u.DeletedAt != nil {
		return user.ErrNotFound
	}
	u.Language, u.UpdatedAt, u.UpdatedByUserID = lang, at, by
	m.users[id] = u
	return nil
}

func (m *memRepo) Delete(_ context.Context, id uuid.UUID, at time.Time, by uuid.UUID, _ uuid.UUID, _ audit.Event) error {
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

// memRoles is an in-memory role.Repository holding the built-in roles, so the
// HTTP tests run the real role service; who holds a role is memRepo's.
type memRoles struct {
	mu    sync.Mutex
	users *memRepo
	roles map[uuid.UUID]role.Role
}

func newMemRoles(users *memRepo) *memRoles {
	m := &memRoles{users: users, roles: map[uuid.UUID]role.Role{}}
	for _, key := range role.BuiltinKeys() {
		k := key
		id := role.BuiltinID(key)
		m.roles[id] = role.Role{ID: id, Key: &k, Name: key, Permissions: role.BuiltinPermissions([]string{key}), Locked: key == role.KeyAdmin}
	}
	return m
}

func (m *memRoles) Create(_ context.Context, r role.Role, _ *audit.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.roles[r.ID] = r
	return nil
}

func (m *memRoles) Get(_ context.Context, id uuid.UUID) (role.Role, error) {
	m.mu.Lock()
	r, ok := m.roles[id]
	m.mu.Unlock()
	if !ok || r.DeletedAt != nil {
		return role.Role{}, role.ErrNotFound
	}
	r.UserCount = m.users.holding(id)
	return r, nil
}

func (m *memRoles) List(context.Context) ([]role.Role, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]role.Role, 0)
	for _, r := range m.roles {
		if r.DeletedAt == nil {
			out = append(out, r)
		}
	}
	return out, nil
}

func (m *memRoles) Update(ctx context.Context, id uuid.UUID, mut role.Mutation) (role.Role, error) {
	cur, err := m.Get(ctx, id)
	if err != nil {
		return role.Role{}, err
	}
	next, _, err := mut(cur)
	if err != nil {
		return role.Role{}, err
	}
	m.mu.Lock()
	m.roles[id] = next
	m.mu.Unlock()
	return next, nil
}

func (m *memRoles) Permissions(_ context.Context, ids []uuid.UUID) ([]role.Permission, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var all []string
	for _, id := range ids {
		if r, ok := m.roles[id]; ok && r.DeletedAt == nil {
			all = append(all, role.Strings(r.Permissions)...)
		}
	}
	return role.Known(all), nil
}

func (m *memRoles) OfUser(ctx context.Context, userID uuid.UUID) ([]role.Role, error) {
	var out []role.Role
	for _, id := range m.users.roleIDs(userID) {
		if r, err := m.Get(ctx, id); err == nil {
			out = append(out, r)
		}
	}
	return out, nil
}

func (m *memRoles) Missing(ctx context.Context, ids []uuid.UUID) ([]uuid.UUID, error) {
	var out []uuid.UUID
	for _, id := range ids {
		if _, err := m.Get(ctx, id); err != nil {
			out = append(out, id)
		}
	}
	return out, nil
}

// memSessions is an in-memory session.Repository, so the HTTP tests run the
// real session service. It writes its security events to log, as the
// Postgres repository writes them to auth_events.
type memSessions struct {
	mu   sync.Mutex
	rows map[uuid.UUID]session.Session
	log  *memSecurity
}

func (m *memSessions) Create(ctx context.Context, s session.Session, ev security.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rows[s.ID] = s
	return m.log.Insert(ctx, ev)
}

func (m *memSessions) Get(_ context.Context, id uuid.UUID) (session.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.rows[id]
	if !ok {
		return session.Session{}, session.ErrNotFound
	}
	return s, nil
}

func (m *memSessions) Update(_ context.Context, id uuid.UUID, mut session.Mutation) (session.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cur, ok := m.rows[id]
	if !ok {
		return session.Session{}, session.ErrNotFound
	}
	next, ev, err := mut(cur)
	if err != nil {
		return session.Session{}, err
	}
	m.rows[id] = next
	if ev != nil {
		return next, m.log.Insert(context.Background(), *ev)
	}
	return next, nil
}

func (m *memSessions) ListLive(_ context.Context, userID uuid.UUID, now time.Time) ([]session.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]session.Session, 0)
	for _, s := range m.rows {
		if s.UserID == userID && s.Live(now) {
			out = append(out, s)
		}
	}
	slices.SortFunc(out, func(a, b session.Session) int { return b.LastUsedAt.Compare(a.LastUsedAt) })
	return out, nil
}

func (m *memSessions) EndAll(ctx context.Context, userID, keep uuid.UUID, at time.Time, reason string, record func(session.Session) security.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, s := range m.rows {
		if s.UserID == userID && id != keep && s.EndedAt == nil {
			s.EndedAt, s.EndReason = &at, reason
			m.rows[id] = s
			if err := m.log.Insert(ctx, record(s)); err != nil {
				return err
			}
		}
	}
	return nil
}

func (m *memSessions) Prune(context.Context, uuid.UUID, time.Time) error { return nil }

// memSystem is an in-memory system.Store keeping the errors recorded, so the
// HTTP tests see what the middleware puts on the error list. Folding and the
// database's figures are the Postgres tests'.
type memSystem struct {
	mu     sync.Mutex
	errors []system.ErrorEvent
}

func (m *memSystem) RecordError(_ context.Context, ev system.ErrorEvent, _ time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.errors = append(m.errors, ev)
	return nil
}

func (m *memSystem) recorded() []system.ErrorEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Clone(m.errors)
}

func (m *memSystem) ListErrors(context.Context, system.ErrorQuery) ([]system.ErrorEvent, error) {
	return nil, nil
}
func (m *memSystem) NewErrorKinds(context.Context, time.Time) (int, error) { return 0, nil }
func (m *memSystem) PurgeErrors(context.Context, time.Time) (int64, error) { return 0, nil }
func (m *memSystem) SampleSize(context.Context, time.Time) error           { return nil }
func (m *memSystem) Database(context.Context, time.Time) (system.Database, error) {
	return system.Database{Connections: map[string]int{}, Tables: []system.Table{}}, nil
}

// memUsage records nothing and reports an empty Usage screen.
type memUsage struct{}

func (memUsage) RecordActivity(context.Context, time.Time, uuid.UUID, string) error { return nil }
func (memUsage) PurgeActivity(context.Context, time.Time) (int64, error)            { return 0, nil }
func (memUsage) SampleQuality(context.Context, usage.Quality) error                 { return nil }
func (memUsage) Read(context.Context, usage.Window) (usage.Report, error)           { return usage.Report{}, nil }

// memSecurity is an in-memory security.Store holding the events written, so
// the per-email sign-in limit works in the HTTP tests. Its reads for the
// Security screen find nothing: the Postgres tests cover them.
type memSecurity struct {
	mu     sync.Mutex
	events []security.Event
}

func (m *memSecurity) Insert(_ context.Context, ev security.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, ev)
	return nil
}

// kinds are the kinds of the events written so far, with their reasons.
func (m *memSecurity) kinds() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, len(m.events))
	for i, ev := range m.events {
		out[i] = string(ev.Kind)
		if ev.Reason != "" {
			out[i] += ":" + ev.Reason
		}
	}
	return out
}

func (m *memSecurity) List(context.Context, security.Query) ([]security.Entry, error) {
	return nil, nil
}

func (m *memSecurity) Failures(_ context.Context, hash []byte, since time.Time, limit int) ([]time.Time, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []time.Time
	for i := len(m.events) - 1; i >= 0 && len(out) < limit; i-- {
		ev := m.events[i]
		if !bytes.Equal(ev.EmailHash, hash) || !ev.OccurredAt.After(since) {
			continue
		}
		if ev.Kind == security.KindSignIn || ev.Kind == security.KindReauth {
			break
		}
		if ev.Reason != security.ReasonTooManyAttempts {
			out = append(out, ev.OccurredAt)
		}
	}
	return out, nil
}

func (m *memSecurity) LiveSessions(context.Context, time.Time) ([]security.LiveSession, error) {
	return nil, nil
}
func (m *memSecurity) Review(context.Context, time.Time) (security.ReviewData, error) {
	return security.ReviewData{}, nil
}
func (m *memSecurity) Reviewed(context.Context, audit.Event) error { return nil }
func (m *memSecurity) Summary(context.Context, time.Time, time.Time) (security.Summary, error) {
	return security.Summary{}, nil
}
func (m *memSecurity) Purge(context.Context, time.Time) (int64, error) {
	return 0, nil
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
func (stubCatalogue) PriceHistory(context.Context, uuid.UUID) ([]catalogue.PriceEntry, error) {
	return []catalogue.PriceEntry{}, nil
}
func (stubCatalogue) Update(context.Context, uuid.UUID, catalogue.Mutation) (catalogue.Item, error) {
	return catalogue.Item{}, catalogue.ErrNotFound
}

// stubAudit is an empty trail with no seals; it keeps the events written to
// it (an export's record).
type stubAudit struct{ written *[]audit.Event }

func (stubAudit) List(context.Context, audit.Query) ([]audit.Entry, error) { return nil, nil }
func (s stubAudit) Insert(_ context.Context, ev audit.Event) error {
	if s.written != nil {
		*s.written = append(*s.written, ev)
	}
	return nil
}
func (stubAudit) EachRow(context.Context, time.Time, time.Time, func(audit.Row) error) error {
	return nil
}
func (stubAudit) FirstEventAt(context.Context) (*time.Time, error) { return nil, nil }
func (stubAudit) Seals(context.Context) ([]audit.Seal, error)      { return nil, nil }
func (stubAudit) AddSeal(context.Context, audit.Seal) error        { return nil }
func (stubAudit) Stamps(context.Context) ([]audit.Stamp, error)    { return nil, nil }
func (stubAudit) AddStamp(context.Context, audit.Stamp) error      { return nil }
func (stubAudit) Purges(context.Context) ([]audit.Purge, error)    { return nil, nil }
func (stubAudit) Purge(_ context.Context, p audit.Purge, _ func(int64) (audit.Event, error)) (audit.Purge, error) {
	return p, nil
}

type stubItemSets struct{}

func (stubItemSets) Create(context.Context, itemset.ItemSet, audit.Event) error { return nil }
func (stubItemSets) Get(context.Context, uuid.UUID) (itemset.ItemSet, error) {
	return itemset.ItemSet{}, itemset.ErrNotFound
}
func (stubItemSets) List(context.Context) ([]itemset.ItemSet, error) { return []itemset.ItemSet{}, nil }
func (stubItemSets) ListActive(context.Context) ([]itemset.ItemSet, error) {
	return []itemset.ItemSet{}, nil
}
func (stubItemSets) Update(context.Context, uuid.UUID, itemset.Mutation) (itemset.ItemSet, error) {
	return itemset.ItemSet{}, itemset.ErrNotFound
}

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
func (stubOrders) LinkOpened(context.Context, uuid.UUID, time.Time, audit.Event) error { return nil }
func (stubOrders) Confirm(context.Context, uuid.UUID, *uuid.UUID, uuid.UUID, order.ConfirmFunc) (order.Order, error) {
	return order.Order{}, order.ErrNotFound
}
func (stubOrders) Delete(context.Context, uuid.UUID, order.DeleteFunc) error {
	return order.ErrNotFound
}
func (stubOrders) ConfirmedFor(context.Context, uuid.UUID) (order.Confirmation, error) {
	return order.Confirmation{}, order.ErrNotFound
}

// stubAssets is an empty register: every asset is missing.
type stubAssets struct{}

func (stubAssets) Create(context.Context, asset.Asset, *asset.Bump, audit.Event) error { return nil }
func (stubAssets) Record(context.Context, audit.Event) error                           { return nil }
func (stubAssets) Get(context.Context, uuid.UUID) (asset.Record, error) {
	return asset.Record{}, asset.ErrNotFound
}
func (stubAssets) Assignments(context.Context, uuid.UUID) ([]asset.Assignment, error) {
	return []asset.Assignment{}, nil
}
func (stubAssets) List(context.Context, asset.ListFilter) ([]asset.Record, int, error) {
	return []asset.Record{}, 0, nil
}
func (stubAssets) Summary(context.Context, asset.Kind) (asset.Summary, error) {
	return asset.Summary{}, nil
}
func (stubAssets) ByNumber(context.Context, string, int) ([]asset.Record, error) {
	return []asset.Record{}, nil
}
func (stubAssets) ByEmployee(context.Context, uuid.UUID) ([]asset.Held, error) {
	return []asset.Held{}, nil
}
func (stubAssets) Employee(context.Context, uuid.UUID) (asset.EmployeeView, error) {
	return asset.EmployeeView{}, asset.ErrEmployeeNotFound
}
func (stubAssets) LastNumber(context.Context, string) (int64, error) { return 0, nil }
func (stubAssets) NumberOwner(context.Context, string) (uuid.UUID, error) {
	return uuid.Nil, asset.ErrNotFound
}
func (stubAssets) SIMOwner(context.Context, string) (uuid.UUID, error) {
	return uuid.Nil, asset.ErrNotFound
}
func (stubAssets) Update(context.Context, uuid.UUID, asset.Mutation) (asset.Record, error) {
	return asset.Record{}, asset.ErrNotFound
}
func (stubAssets) Give(context.Context, uuid.UUID, uuid.UUID, asset.GiveFunc) (asset.Assignment, error) {
	return asset.Assignment{}, asset.ErrNotFound
}
func (stubAssets) UpdateOpen(context.Context, uuid.UUID, asset.OpenMutation) (asset.Assignment, error) {
	return asset.Assignment{}, asset.ErrNotFound
}
func (stubAssets) AddSignedCopy(context.Context, uuid.UUID, uuid.UUID, asset.SignedCopyFunc) error {
	return asset.ErrNotFound
}
func (stubAssets) SignedCopy(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (asset.SignedCopy, error) {
	return asset.SignedCopy{}, asset.ErrNotFound
}

type stubDashboard struct{}

func (stubDashboard) ReadSetup(context.Context) (dashboard.Setup, error) {
	return dashboard.Setup{}, nil
}
func (stubDashboard) Read(context.Context, dashboard.Window) (dashboard.Overview, error) {
	return dashboard.Overview{}, nil
}
func (stubDashboard) ReadEmployee(context.Context, dashboard.EmployeeWindow) (dashboard.EmployeeOverview, error) {
	return dashboard.EmployeeOverview{}, nil
}
func (stubDashboard) ReadManager(context.Context, dashboard.ManagerWindow) (dashboard.ManagerFigures, error) {
	return dashboard.ManagerFigures{}, nil
}
func (stubDashboard) ReadReplacements(context.Context, time.Time, time.Time, int) (dashboard.Replacements, error) {
	return dashboard.Replacements{}, nil
}

// stubSettings keeps the settings in memory: the policy test only needs a
// repository that answers.
type stubSettings struct{ cur settings.Settings }

func (s *stubSettings) Get(context.Context) (settings.Settings, error) { return s.cur, nil }
func (s *stubSettings) Update(_ context.Context, m settings.Mutation) (settings.Settings, error) {
	next, _, err := m(s.cur)
	if err == nil {
		s.cur = next
	}
	return next, err
}

type stubBackups struct{}

func (stubBackups) Read(context.Context, int) (backup.Status, error) { return backup.Status{}, nil }

var testLogger = slog.New(slog.NewTextHandler(io.Discard, nil))

func testConfig() config {
	return config{
		LoginRateLimit: 100, LoginRateInterval: time.Minute, RequestTimeout: 5 * time.Second, OrgTimezone: "Europe/Vilnius", PublicBaseURL: "https://work.example.com",
		JWTSecret: testSecret, SessionMaxAge: 12 * time.Hour, SessionKeepMaxAge: 30 * 24 * time.Hour, SessionKeepIdle: 14 * 24 * time.Hour, RecentSignIn: 12 * time.Hour,
	}
}

type testAPI struct {
	handler http.Handler
	svc     services
	tokens  *tokens
	admin   user.User
	log     *memSecurity
	errors  *memSystem
}

func newTestAPI(t *testing.T) *testAPI {
	t.Helper()
	log := &memSecurity{}
	errs := &memSystem{}
	sessions := session.NewService(&memSessions{rows: map[uuid.UUID]session.Session{}, log: log}, sessionKey(testSecret), sessionLimits(testConfig()))
	userRepo := &memRepo{users: map[uuid.UUID]user.User{}}
	roles := role.NewService(newMemRoles(userRepo))
	users := user.NewService(userRepo,
		user.WithHasher(func(p string) (string, error) { return "h:" + p, nil }, func(h, p string) bool { return h == "h:"+p }),
		user.WithSessions(userSessions{sessions}), user.WithRoles(roles), user.WithGuardRole(role.AdminID))
	admin, err := users.Bootstrap(context.Background(), "admin@example.com", "Admin", "password123", []uuid.UUID{role.AdminID})
	if err != nil {
		t.Fatal(err)
	}
	svc := newServices(time.UTC, time.Hour, 0, sessions, security.NewService(log, securityConfig(testConfig())), roles, users, stubEmployees{}, stubCatalogue{}, stubItemSets{}, stubOrders{}, stubAssets{}, nil, stubDashboard{}, &stubSettings{}, stubBackups{}, stubAudit{}, errs, memUsage{}, nil)
	svc.ready = stubReady{}
	tok := testTokens(time.Now())
	return &testAPI{handler: routes(testConfig(), svc, tok, testLogger), svc: svc, tokens: tok, admin: admin, log: log, errors: errs}
}

// userWith adds a user holding the built-in roles named by keys and signs them in.
func (a *testAPI) userWith(t *testing.T, keys ...string) (user.User, string) {
	t.Helper()
	ids := make([]uuid.UUID, len(keys))
	for i, k := range keys {
		ids[i] = role.BuiltinID(k)
	}
	u, err := a.svc.users.Create(context.Background(), user.CreateParams{
		Email: uuid.NewString()[:8] + "@example.com", Name: "U", Password: "password123", RoleIDs: ids,
	}, a.admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	return u, a.signIn(t, u)
}

// signIn starts a session for u, as login would, and returns its access token.
func (a *testAPI) signIn(t *testing.T, u user.User) string {
	t.Helper()
	s, _, err := a.svc.sessions.Start(context.Background(), session.StartParams{UserID: u.ID, KeepSignedIn: true})
	if err != nil {
		t.Fatal(err)
	}
	perms, err := a.svc.roles.Permissions(context.Background(), u.RoleIDs)
	if err != nil {
		t.Fatal(err)
	}
	tok, _, err := a.tokens.issue(u, perms, s.ID, s.AuthenticatedAt)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

// tokenWith returns a token for the administrator granting exactly perms,
// whatever the administrator's roles grant.
func (a *testAPI) tokenWith(t *testing.T, perms ...role.Permission) string {
	t.Helper()
	s, _, err := a.svc.sessions.Start(context.Background(), session.StartParams{UserID: a.admin.ID, KeepSignedIn: true})
	if err != nil {
		t.Fatal(err)
	}
	tok, _, err := a.tokens.issue(a.admin, perms, s.ID, s.AuthenticatedAt)
	if err != nil {
		t.Fatal(err)
	}
	return tok
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

// rule is a route's access: the permission it requires ("" for any signed-in
// user) and who could call it before permissions existed, which the built-in
// roles must keep reproducing (TestSeededRolesKeepPolicy).
type rule struct {
	perm     role.Permission
	audience string
}

// policy pins who may call every route. Changing a route's access, or adding
// a route, must change this table: TestRoutePolicy fails otherwise.
var policy = map[string]rule{
	"GET /health":                       {"", "public"},
	"GET /ready":                        {"", "public"},
	"POST /api/v1/auth/login":           {"", "public"},
	"POST /api/v1/auth/refresh":         {"", "public"},
	"POST /api/v1/auth/logout":          {"", "public"},
	"POST /api/v1/auth/reauth":          {"", "any"},
	"GET /api/v1/auth/sessions":         {"", "any"},
	"DELETE /api/v1/auth/sessions":      {"", "any"},
	"DELETE /api/v1/auth/sessions/{id}": {"", "any"},

	"GET /api/v1/users/me":               {"", "any"},
	"PUT /api/v1/users/me/password":      {"", "any"},
	"GET /api/v1/users":                  {role.UsersRead, "managers"},
	"GET /api/v1/users/{id}":             {role.UsersRead, "managers"},
	"GET /api/v1/users/by-email/{email}": {role.UsersRead, "managers"},
	"POST /api/v1/users":                 {role.UsersManage, "admins"},
	"PUT /api/v1/users/{id}":             {role.UsersManage, "admins"},
	"PUT /api/v1/users/{id}/password":    {role.UsersManage, "admins"},
	"PUT /api/v1/users/me/language":      {"", "any"},
	"DELETE /api/v1/users/{id}":          {role.UsersManage, "admins"},

	"GET /api/v1/permissions":   {role.UsersRead, "managers"},
	"GET /api/v1/roles":         {role.UsersRead, "managers"},
	"GET /api/v1/roles/{id}":    {role.UsersRead, "managers"},
	"POST /api/v1/roles":        {role.RolesManage, "admins"},
	"PUT /api/v1/roles/{id}":    {role.RolesManage, "admins"},
	"DELETE /api/v1/roles/{id}": {role.RolesManage, "admins"},

	"GET /api/v1/employees":             {"", "any"},
	"GET /api/v1/employees/{id}":        {"", "any"},
	"GET /api/v1/employees/by-name/{q}": {"", "any"},
	"POST /api/v1/employees":            {"", "any"},
	"PUT /api/v1/employees/{id}":        {"", "any"},
	"PUT /api/v1/employees/{id}/sizes":  {"", "any"},
	"DELETE /api/v1/employees/{id}":     {role.EmployeesDelete, "managers"},

	"GET /api/v1/catalogue":                    {"", "any"},
	"GET /api/v1/catalogue/active":             {"", "any"},
	"GET /api/v1/catalogue/{id}":               {"", "any"},
	"GET /api/v1/catalogue/{id}/price-history": {"", "any"},
	"POST /api/v1/catalogue":                   {role.CatalogueManage, "managers"},
	"PUT /api/v1/catalogue/{id}":               {role.CatalogueManage, "managers"},
	"POST /api/v1/catalogue/{id}/activate":     {role.CatalogueManage, "managers"},
	"POST /api/v1/catalogue/{id}/deactivate":   {role.CatalogueManage, "managers"},
	"DELETE /api/v1/catalogue/{id}":            {role.CatalogueManage, "managers"},

	"GET /api/v1/item-sets":                                                     {"", "any"},
	"GET /api/v1/item-sets/active":                                              {"", "any"},
	"GET /api/v1/item-sets/{id}":                                                {"", "any"},
	"POST /api/v1/item-sets":                                                    {role.ItemSetsManage, "managers"},
	"PUT /api/v1/item-sets/{id}":                                                {role.ItemSetsManage, "managers"},
	"DELETE /api/v1/item-sets/{id}":                                             {role.ItemSetsManage, "managers"},
	"GET /api/v1/item-sets/{id}/apply/{employeeID}":                             {"", "any"},
	"GET /api/v1/sizes":                                                         {"", "any"},
	"POST /api/v1/orders/resolve":                                               {"", "any"},
	"POST /api/v1/orders":                                                       {"", "any"},
	"GET /api/v1/orders":                                                        {"", "any"},
	"GET /api/v1/settings":                                                      {"", "any"},
	"PUT /api/v1/settings/supplier-chat":                                        {role.SettingsManage, "admins"},
	"PUT /api/v1/settings/default-sim-provider":                                 {role.AssetsManage, "managers"},
	"POST /api/v1/orders/{id}/confirmation-link":                                {"", "any"},
	"POST /api/v1/orders/{id}/confirm-paper":                                    {"", "any"},
	"POST /api/v1/orders/{id}/confirm-in-person":                                {"", "any"},
	"GET /api/v1/orders/{id}/record":                                            {"", "any"},
	"POST /api/v1/confirmations/view":                                           {"", "public"},
	"POST /api/v1/confirmations/confirm":                                        {"", "public"},
	"GET /api/v1/orders/{id}":                                                   {"", "any"},
	"DELETE /api/v1/orders/{id}":                                                {role.OrdersDelete, "manager"},
	"GET /api/v1/assets":                                                        {"", "any"},
	"GET /api/v1/assets/summary/{kind}":                                         {"", "any"},
	"GET /api/v1/assets/by-number/{q}":                                          {"", "any"},
	"GET /api/v1/assets/by-employee/{id}":                                       {"", "any"},
	"GET /api/v1/assets/next-number/{prefix}":                                   {role.AssetsManage, "managers"},
	"GET /api/v1/assets/{id}":                                                   {"", "any"},
	"POST /api/v1/assets":                                                       {role.AssetsManage, "managers"},
	"PUT /api/v1/assets/{id}":                                                   {role.AssetsManage, "managers"},
	"PUT /api/v1/assets/{id}/status":                                            {role.AssetsManage, "managers"},
	"POST /api/v1/assets/{id}/form-printed":                                     {role.AssetsManage, "managers"},
	"POST /api/v1/assets/{id}/assignments/{assignmentID}/form-printed":          {"", "any"},
	"POST /api/v1/assets/{id}/blocking-email":                                   {role.AssetsManage, "managers"},
	"GET /api/v1/assets/{id}/assignments/preview.pdf":                           {role.AssetsManage, "managers"},
	"GET /api/v1/assets/{id}/assignments/{assignmentID}/form.pdf":               {"", "any"},
	"POST /api/v1/assets/{id}/assignments/preview":                              {role.AssetsManage, "managers"},
	"POST /api/v1/assets/{id}/assignments":                                      {role.AssetsManage, "managers"},
	"POST /api/v1/assets/{id}/return":                                           {role.AssetsManage, "managers"},
	"POST /api/v1/assets/{id}/not-returned":                                     {role.AssetsManage, "managers"},
	"GET /api/v1/assets/{id}/assignments/{assignmentID}/form":                   {"", "any"},
	"POST /api/v1/assets/{id}/assignments/{assignmentID}/signed-copies":         {role.AssetsManage, "managers"},
	"GET /api/v1/assets/{id}/assignments/{assignmentID}/signed-copies/{copyID}": {"", "any"},
	"GET /api/v1/audit-events/assets/{id}":                                      {"", "any"},
	"GET /api/v1/dashboard":                                                     {role.DashboardOverview, "admins"},
	"GET /api/v1/dashboard/manager":                                             {role.DashboardManager, "manager"},
	"GET /api/v1/dashboard/employee":                                            {role.DashboardEmployee, "employee"},
	"GET /api/v1/replacements":                                                  {"", "any"},
	"GET /api/v1/backups":                                                       {role.BackupsRead, "admins"},
	"GET /api/v1/audit-events":                                                  {role.AuditRead, "admins"},
	"GET /api/v1/audit-events/{id}":                                             {role.AuditRead, "admins"},
	"GET /api/v1/audit-events/integrity":                                        {role.AuditRead, "admins"},
	"POST /api/v1/audit-events/verify":                                          {role.AuditRead, "admins"},
	"GET /api/v1/audit-events/export":                                           {role.AuditExport, "admins"},
	"GET /api/v1/audit-events/employees/{id}":                                   {"", "any"},
	"GET /api/v1/audit-events/catalogue/{id}":                                   {"", "any"},
	"GET /api/v1/audit-events/orders/{id}":                                      {"", "any"},
	"GET /api/v1/audit-events/users/{id}":                                       {role.UsersRead, "managers"},
	"GET /api/v1/security/events":                                               {role.SecurityRead, "admins"},
	"GET /api/v1/security/sessions":                                             {role.SecurityRead, "admins"},
	"DELETE /api/v1/security/sessions/{id}":                                     {role.UsersManage, "admins"},
	"GET /api/v1/security/access-review":                                        {role.SecurityRead, "admins"},
	"POST /api/v1/security/access-review":                                       {role.SecurityRead, "admins"},
	"GET /api/v1/system/status":                                                 {role.SystemRead, "admins"},
	"GET /api/v1/system/errors":                                                 {role.SystemRead, "admins"},
	"GET /api/v1/system/errors/{id}":                                            {role.SystemRead, "admins"},
	"POST /api/v1/client-errors":                                                {"", "any"},
	"GET /api/v1/overview":                                                      {"", "any"},
	"GET /api/v1/usage":                                                         {role.UsageRead, "admins"},
}

// allowedRoles is who each audience was before permissions: the three fixed roles.
var allowedRoles = map[string][]string{
	"any":      {role.KeyAdmin, role.KeyManager, role.KeyEmployee},
	"managers": {role.KeyAdmin, role.KeyManager},
	"admins":   {role.KeyAdmin},
	"manager":  {role.KeyManager},
	"employee": {role.KeyEmployee},
}

var wildcard = regexp.MustCompile(`\{[^}]+\}`)

// TestSeededRolesKeepPolicy pins that the built-in roles' permissions grant
// each route to exactly the roles that could call it before permissions.
func TestSeededRolesKeepPolicy(t *testing.T) {
	for pattern, rule := range policy {
		if rule.audience == "public" {
			continue
		}
		for _, key := range role.BuiltinKeys() {
			granted := rule.perm == "" || slices.Contains(role.BuiltinPermissions([]string{key}), rule.perm)
			if want := slices.Contains(allowedRoles[rule.audience], key); granted != want {
				t.Errorf("%s: role %s granted %v, want %v", pattern, key, granted, want)
			}
		}
	}
}

func TestRoutePolicy(t *testing.T) {
	api := newTestAPI(t)
	roleTokens := map[string]string{}
	for _, key := range role.BuiltinKeys() {
		_, roleTokens[key] = api.userWith(t, key)
	}
	all := make([]role.Permission, 0)
	for _, p := range role.Catalogue() {
		all = append(all, p.Key)
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
		if r.access.public != (want.audience == "public") || r.access.perm != want.perm {
			t.Errorf("%s: registered %+v, policy says %+v", r.pattern, r.access, want)
		}
	}
	for pattern := range policy {
		if !registered[pattern] {
			t.Errorf("policy entry %q matches no registered route", pattern)
		}
	}

	// Behaviour: no token is 401; a token lacking the route's permission is
	// 403 and one holding only it gets past authorization (any status but
	// 401/403); and each built-in role gets exactly its old access.
	for pattern, rule := range policy {
		if rule.audience == "public" {
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
			check := func(who, token string, allowed bool) {
				code := api.do(t, method, path, token, body).Code
				switch {
				case allowed && (code == http.StatusUnauthorized || code == http.StatusForbidden):
					t.Errorf("%s: %d, want access", who, code)
				case !allowed && code != http.StatusForbidden:
					t.Errorf("%s: %d, want 403", who, code)
				}
			}
			if rule.perm != "" {
				others := slices.DeleteFunc(slices.Clone(all), func(p role.Permission) bool { return p == rule.perm })
				check("every other permission", api.tokenWith(t, others...), false)
				check("only "+string(rule.perm), api.tokenWith(t, rule.perm), true)
			} else {
				check("no permissions", api.tokenWith(t), true)
			}
			for _, key := range role.BuiltinKeys() {
				check("role "+key, roleTokens[key], slices.Contains(allowedRoles[rule.audience], key))
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

// Failed sign-ins for one account are limited whatever address they come
// from; another account is not affected, and the account's owner can sign in
// again once the window ends.
func TestLoginLimitedPerEmail(t *testing.T) {
	api := newTestAPI(t)
	trusted, _ := middleware.ParseTrustedProxies([]string{"127.0.0.1"})
	cfg := testConfig()
	cfg.TrustedProxies, cfg.LoginEmailFailures, cfg.LoginEmailInterval = trusted, 2, time.Minute
	api.svc.security = security.NewService(api.log, securityConfig(cfg))
	api.handler = routes(cfg, api.svc, api.tokens, testLogger)
	login := func(client, email, password string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"email": email, "password": password})
		req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(body))
		req.RemoteAddr = "127.0.0.1:40000"
		req.Header.Set("X-Forwarded-For", client)
		rec := httptest.NewRecorder()
		api.handler.ServeHTTP(rec, req)
		return rec
	}
	// A success clears earlier failures.
	login("203.0.113.1", "admin@example.com", "wrong-password")
	if rec := login("203.0.113.1", "admin@example.com", "password123"); rec.Code != http.StatusOK {
		t.Fatalf("sign-in after one failure = %d, want 200", rec.Code)
	}
	// Two failures from two addresses, then even the right password is refused.
	login("203.0.113.1", "admin@example.com", "wrong-password")
	login("203.0.113.2", "ADMIN@example.com", "wrong-password")
	rec := login("203.0.113.3", "admin@example.com", "password123")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("third attempt = %d, want 429", rec.Code)
	}
	if ra := rec.Header().Get("Retry-After"); ra == "" || ra == "0" {
		t.Errorf("Retry-After = %q, want seconds", ra)
	}
	if !strings.Contains(rec.Body.String(), "too many failed sign-ins") {
		t.Errorf("body = %s", rec.Body)
	}
	// Another account still signs in (it has no such user, so 401, not 429).
	if rec := login("203.0.113.3", "someone@example.com", "password123"); rec.Code != http.StatusUnauthorized {
		t.Errorf("other account = %d, want 401", rec.Code)
	}
}

// Behind a trusted proxy each client has its own login budget; without the
// proxy setting, every client behind it would share one.
func TestLoginRateLimitPerClientBehindProxy(t *testing.T) {
	api := newTestAPI(t)
	trusted, _ := middleware.ParseTrustedProxies([]string{"127.0.0.1"})
	cfg := config{LoginRateLimit: 2, LoginRateInterval: time.Minute, RequestTimeout: 5 * time.Second, TrustedProxies: trusted}
	api.handler = routes(cfg, api.svc, api.tokens, testLogger)
	login := func(remote, xff string) int {
		body := strings.NewReader(`{"email":"x@example.com","password":"password123"}`)
		req := httptest.NewRequest("POST", "/api/v1/auth/login", body)
		req.RemoteAddr = remote
		if xff != "" {
			req.Header.Set("X-Forwarded-For", xff)
		}
		rec := httptest.NewRecorder()
		api.handler.ServeHTTP(rec, req)
		return rec.Code
	}
	for range 2 {
		login("127.0.0.1:40000", "203.0.113.1")
	}
	if code := login("127.0.0.1:40000", "203.0.113.1"); code != http.StatusTooManyRequests {
		t.Fatalf("first client, third attempt = %d, want 429", code)
	}
	if code := login("127.0.0.1:40000", "203.0.113.2"); code == http.StatusTooManyRequests {
		t.Fatal("a second client behind the proxy was limited by the first")
	}
	// An untrusted peer cannot dodge its own limit by inventing a header.
	for range 2 {
		login("198.51.100.9:5000", "")
	}
	if code := login("198.51.100.9:5000", "203.0.113.99"); code != http.StatusTooManyRequests {
		t.Fatalf("spoofed X-Forwarded-For from an untrusted peer = %d, want 429", code)
	}
}

func TestDeletedUserTokenIsUnauthenticated(t *testing.T) {
	api := newTestAPI(t)
	u, tok := api.userWith(t, role.KeyEmployee)
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
