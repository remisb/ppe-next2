package user

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// fakeRepo mirrors the Postgres contract: live-only reads, case-insensitive
// email uniqueness among live rows, soft delete.
type fakeRepo struct {
	mu    sync.Mutex
	users map[uuid.UUID]User
}

func newFakeRepo() *fakeRepo { return &fakeRepo{users: map[uuid.UUID]User{}} }

func (f *fakeRepo) emailTaken(email string, except uuid.UUID) bool {
	for _, u := range f.users {
		if u.ID != except && !u.Deleted() && strings.EqualFold(u.Email, email) {
			return true
		}
	}
	return false
}

func (f *fakeRepo) Create(_ context.Context, u User) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.emailTaken(u.Email, u.ID) {
		return ErrEmailTaken
	}
	if _, ok := f.users[u.CreatedByUserID]; !ok && u.CreatedByUserID != u.ID {
		return ErrActorNotFound
	}
	f.users[u.ID] = u
	return nil
}

func (f *fakeRepo) Get(_ context.Context, id uuid.UUID) (User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	u, ok := f.users[id]
	if !ok || u.Deleted() {
		return User{}, ErrNotFound
	}
	return u, nil
}

func (f *fakeRepo) ByEmail(_ context.Context, email string) (User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, u := range f.users {
		if !u.Deleted() && strings.EqualFold(u.Email, email) {
			return u, nil
		}
	}
	return User{}, ErrNotFound
}

func (f *fakeRepo) List(_ context.Context) ([]User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]User, 0)
	for _, u := range f.users {
		if !u.Deleted() {
			out = append(out, u)
		}
	}
	return out, nil
}

func (f *fakeRepo) Update(_ context.Context, u User) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.users[u.ID]
	if !ok || cur.Deleted() {
		return ErrNotFound
	}
	if f.emailTaken(u.Email, u.ID) {
		return ErrEmailTaken
	}
	cur.Email, cur.Name, cur.Roles, cur.IsActive = u.Email, u.Name, u.Roles, u.IsActive
	cur.UpdatedAt, cur.UpdatedByUserID = u.UpdatedAt, u.UpdatedByUserID
	f.users[u.ID] = cur
	return nil
}

func (f *fakeRepo) SetPasswordHash(_ context.Context, id uuid.UUID, hash string, at time.Time, by uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	u, ok := f.users[id]
	if !ok || u.Deleted() {
		return ErrNotFound
	}
	u.PasswordHash, u.UpdatedAt, u.UpdatedByUserID = hash, at, by
	f.users[id] = u
	return nil
}

func (f *fakeRepo) SetLanguage(_ context.Context, id uuid.UUID, lang string, at time.Time, by uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	u, ok := f.users[id]
	if !ok || u.Deleted() {
		return ErrNotFound
	}
	u.Language, u.UpdatedAt, u.UpdatedByUserID = lang, at, by
	f.users[id] = u
	return nil
}

func (f *fakeRepo) Delete(_ context.Context, id uuid.UUID, at time.Time, by uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	u, ok := f.users[id]
	if !ok || u.Deleted() {
		return ErrNotFound
	}
	u.DeletedAt, u.DeletedByUserID = &at, &by
	f.users[id] = u
	return nil
}

var testNow = time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)

// fakeHash keeps tests fast; bcrypt is exercised by TestBcryptRoundTrip.
func fakeHash(pw string) (string, error) { return "hash:" + pw, nil }
func fakeVerify(hash, pw string) bool    { return hash == "hash:"+pw }

func newTestService(t *testing.T) (*Service, *fakeRepo, User) {
	t.Helper()
	repo := newFakeRepo()
	svc := NewService(repo, WithClock(func() time.Time { return testNow }), WithHasher(fakeHash, fakeVerify))
	admin, err := svc.Bootstrap(context.Background(), "Admin@Example.com", "Admin", "password123")
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	return svc, repo, admin
}

func TestBootstrapIsSelfAttributedAdmin(t *testing.T) {
	_, _, admin := newTestService(t)
	if admin.CreatedByUserID != admin.ID || admin.UpdatedByUserID != admin.ID {
		t.Errorf("actor columns = %v/%v, want own id %v", admin.CreatedByUserID, admin.UpdatedByUserID, admin.ID)
	}
	if admin.Email != "admin@example.com" {
		t.Errorf("email = %q, want normalized lowercase", admin.Email)
	}
	if len(admin.Roles) != 1 || admin.Roles[0] != RoleAdmin {
		t.Errorf("roles = %v, want [admin]", admin.Roles)
	}
}

func TestCreateValidation(t *testing.T) {
	svc, _, admin := newTestService(t)
	valid := CreateParams{Email: "e@example.com", Name: "E", Password: "password123", Roles: []string{"employee"}}
	tests := []struct {
		name   string
		mutate func(*CreateParams)
		actor  uuid.UUID
		want   error
	}{
		{"valid", func(*CreateParams) {}, admin.ID, nil},
		{"missing email", func(p *CreateParams) { p.Email = " " }, admin.ID, ErrInvalid},
		{"bad email", func(p *CreateParams) { p.Email = "not-an-email" }, admin.ID, ErrInvalid},
		{"display-name email", func(p *CreateParams) { p.Email = "E <e@example.com>" }, admin.ID, ErrInvalid},
		{"missing name", func(p *CreateParams) { p.Name = "" }, admin.ID, ErrInvalid},
		{"short password", func(p *CreateParams) { p.Password = "short" }, admin.ID, ErrInvalid},
		{"long password", func(p *CreateParams) { p.Password = strings.Repeat("x", 73) }, admin.ID, ErrInvalid},
		{"no roles", func(p *CreateParams) { p.Roles = nil }, admin.ID, ErrInvalid},
		{"unknown role", func(p *CreateParams) { p.Roles = []string{"viewer"} }, admin.ID, ErrInvalid},
		{"nil actor", func(*CreateParams) {}, uuid.Nil, ErrInvalid},
		{"unknown actor", func(*CreateParams) {}, uuid.New(), ErrActorNotFound},
		{"duplicate email any case", func(p *CreateParams) { p.Email = "ADMIN@example.com" }, admin.ID, ErrEmailTaken},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := valid
			p.Email = uuid.NewString()[:8] + "@example.com"
			tt.mutate(&p)
			_, err := svc.Create(context.Background(), p, tt.actor)
			if !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestCreateNormalizesRoles(t *testing.T) {
	svc, _, admin := newTestService(t)
	u, err := svc.Create(context.Background(), CreateParams{
		Email: "m@example.com", Name: " M ", Password: "password123",
		Roles: []string{" Manager", "employee", "manager"},
	}, admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(u.Roles, ","); got != "employee,manager" {
		t.Errorf("roles = %q, want employee,manager", got)
	}
	if u.Name != "M" || u.CreatedByUserID != admin.ID || !u.IsActive {
		t.Errorf("unexpected user %+v", u)
	}
}

func TestAuthenticate(t *testing.T) {
	svc, _, admin := newTestService(t)
	ctx := context.Background()
	inactive, err := svc.Create(ctx, CreateParams{Email: "off@example.com", Name: "Off", Password: "password123", Roles: []string{RoleEmployee}}, admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Update(ctx, inactive.ID, UpdateParams{Email: inactive.Email, Name: inactive.Name, Roles: inactive.Roles, IsActive: false}, admin.ID); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name, email, pw string
		want            error
	}{
		{"ok, email case-insensitive", "ADMIN@example.com", "password123", nil},
		{"wrong password", "admin@example.com", "nope-nope", ErrInvalidCredentials},
		{"unknown email", "ghost@example.com", "password123", ErrInvalidCredentials},
		{"inactive", "off@example.com", "password123", ErrInvalidCredentials},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.Authenticate(ctx, tt.email, tt.pw)
			if !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestUpdateSelfLockoutGuards(t *testing.T) {
	svc, _, admin := newTestService(t)
	ctx := context.Background()
	base := UpdateParams{Email: admin.Email, Name: admin.Name, Roles: []string{RoleAdmin}, IsActive: true}

	p := base
	p.IsActive = false
	if _, err := svc.Update(ctx, admin.ID, p, admin.ID); !errors.Is(err, ErrInvalid) {
		t.Errorf("self-deactivate err = %v, want ErrInvalid", err)
	}
	p = base
	p.Roles = []string{RoleManager}
	if _, err := svc.Update(ctx, admin.ID, p, admin.ID); !errors.Is(err, ErrInvalid) {
		t.Errorf("self-demote err = %v, want ErrInvalid", err)
	}
	p = base
	p.Name = "Renamed"
	u, err := svc.Update(ctx, admin.ID, p, admin.ID)
	if err != nil || u.Name != "Renamed" {
		t.Errorf("self rename = %+v, %v", u, err)
	}
}

func TestPasswords(t *testing.T) {
	svc, _, admin := newTestService(t)
	ctx := context.Background()

	if err := svc.ChangePassword(ctx, admin.ID, uuid.Nil, "wrong-current", "newpassword1"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("wrong current err = %v, want ErrInvalid", err)
	}
	if err := svc.ChangePassword(ctx, admin.ID, uuid.Nil, "password123", "newpassword1"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Authenticate(ctx, admin.Email, "newpassword1"); err != nil {
		t.Fatalf("login with new password: %v", err)
	}

	other, _ := svc.Create(ctx, CreateParams{Email: "o@example.com", Name: "O", Password: "password123", Roles: []string{RoleEmployee}}, admin.ID)
	if err := svc.SetPassword(ctx, other.ID, "short", admin.ID); !errors.Is(err, ErrInvalid) {
		t.Errorf("short reset err = %v", err)
	}
	if err := svc.SetPassword(ctx, uuid.New(), "password456", admin.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("reset unknown err = %v", err)
	}
	if err := svc.SetPassword(ctx, other.ID, "password456", admin.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Authenticate(ctx, other.Email, "password456"); err != nil {
		t.Errorf("login after reset: %v", err)
	}
}

// endedSessions records the sign-ins the service asks to end.
type endedSessions struct{ calls []string }

func (e *endedSessions) EndAll(_ context.Context, userID, keep uuid.UUID, reason string) error {
	e.calls = append(e.calls, userID.String()+" keep "+keep.String()+" "+reason)
	return nil
}

// A password change ends the user's other sign-ins; a reset, deactivation or
// deletion ends them all. A failed change, a profile edit or a reactivation
// ends none.
func TestSessionsEnd(t *testing.T) {
	ended := &endedSessions{}
	svc := NewService(newFakeRepo(), WithClock(func() time.Time { return testNow }), WithHasher(fakeHash, fakeVerify), WithSessions(ended))
	ctx := context.Background()
	admin, _ := svc.Bootstrap(ctx, "admin@example.com", "Admin", "password123")
	u, _ := svc.Create(ctx, CreateParams{Email: "u@example.com", Name: "U", Password: "password123", Roles: []string{RoleEmployee}}, admin.ID)
	here := uuid.New()
	expect := func(want ...string) {
		t.Helper()
		if !slices.Equal(ended.calls, want) {
			t.Errorf("ended = %v, want %v", ended.calls, want)
		}
		ended.calls = nil
	}

	_ = svc.ChangePassword(ctx, u.ID, here, "wrong-password", "password456")
	expect()
	if err := svc.ChangePassword(ctx, u.ID, here, "password123", "password456"); err != nil {
		t.Fatal(err)
	}
	expect(u.ID.String() + " keep " + here.String() + " " + EndPasswordChanged)
	if err := svc.CheckPassword(ctx, u.ID, "password456"); err != nil {
		t.Errorf("check the new password: %v", err)
	}
	if err := svc.CheckPassword(ctx, u.ID, "password123"); !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "password is incorrect") {
		t.Errorf("check the old password: %v", err)
	}

	if err := svc.SetPassword(ctx, u.ID, "password789", admin.ID); err != nil {
		t.Fatal(err)
	}
	expect(u.ID.String() + " keep " + uuid.Nil.String() + " " + EndPasswordReset)

	p := UpdateParams{Email: u.Email, Name: "Renamed", Roles: u.Roles, IsActive: true}
	if _, err := svc.Update(ctx, u.ID, p, admin.ID); err != nil {
		t.Fatal(err)
	}
	expect()
	p.IsActive = false
	if _, err := svc.Update(ctx, u.ID, p, admin.ID); err != nil {
		t.Fatal(err)
	}
	expect(u.ID.String() + " keep " + uuid.Nil.String() + " " + EndDeactivated)
	if _, err := svc.Update(ctx, u.ID, p, admin.ID); err != nil {
		t.Fatal(err)
	}
	p.IsActive = true
	if _, err := svc.Update(ctx, u.ID, p, admin.ID); err != nil {
		t.Fatal(err)
	}
	expect()

	if err := svc.Delete(ctx, u.ID, admin.ID); err != nil {
		t.Fatal(err)
	}
	expect(u.ID.String() + " keep " + uuid.Nil.String() + " " + EndDeleted)
}

func TestDeleteIsSoftAndFreesEmail(t *testing.T) {
	svc, repo, admin := newTestService(t)
	ctx := context.Background()
	u, _ := svc.Create(ctx, CreateParams{Email: "d@example.com", Name: "D", Password: "password123", Roles: []string{RoleEmployee}}, admin.ID)

	if err := svc.Delete(ctx, admin.ID, admin.ID); !errors.Is(err, ErrInvalid) {
		t.Errorf("self delete err = %v, want ErrInvalid", err)
	}
	if err := svc.Delete(ctx, u.ID, admin.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete(ctx, u.ID, admin.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete err = %v, want ErrNotFound", err)
	}
	if _, err := svc.Get(ctx, u.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("get deleted err = %v, want ErrNotFound", err)
	}
	if row := repo.users[u.ID]; row.DeletedByUserID == nil || *row.DeletedByUserID != admin.ID {
		t.Errorf("deleted_by = %v, want %v", row.DeletedByUserID, admin.ID)
	}
	if _, err := svc.Create(ctx, CreateParams{Email: "D@example.com", Name: "D2", Password: "password123", Roles: []string{RoleEmployee}}, admin.ID); err != nil {
		t.Errorf("reuse deleted email: %v", err)
	}
}

func TestBcryptRoundTrip(t *testing.T) {
	h, err := bcryptHash("password123")
	if err != nil {
		t.Fatal(err)
	}
	if !bcryptVerify(h, "password123") || bcryptVerify(h, "password124") {
		t.Error("bcrypt verify mismatch")
	}
}

func TestSetLanguage(t *testing.T) {
	svc, _, admin := newTestService(t)
	ctx := context.Background()
	if admin.Language != LangEnglish {
		t.Errorf("new account language = %q, want en", admin.Language)
	}
	u, err := svc.SetLanguage(ctx, admin.ID, LangLithuanian)
	if err != nil || u.Language != LangLithuanian || u.UpdatedByUserID != admin.ID {
		t.Fatalf("SetLanguage = %+v, %v", u, err)
	}
	for _, bad := range []string{"", "de", "LT", "en-GB"} {
		if _, err := svc.SetLanguage(ctx, admin.ID, bad); !errors.Is(err, ErrInvalid) {
			t.Errorf("language %q: %v, want ErrInvalid", bad, err)
		}
	}
	if _, err := svc.SetLanguage(ctx, uuid.Nil, LangRussian); !errors.Is(err, ErrInvalid) {
		t.Errorf("nil user: %v, want ErrInvalid", err)
	}
	if _, err := svc.SetLanguage(ctx, uuid.New(), LangRussian); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown user: %v, want ErrNotFound", err)
	}
}
