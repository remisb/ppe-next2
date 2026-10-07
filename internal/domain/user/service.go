package user

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/role"
)

// Audit event names written by this service, all of entity type "user".
// Password events record that it happened, never a value.
const (
	EventCreated         = "user.created"
	EventUpdated         = "user.updated"
	EventRolesChanged    = "user.roles_changed"
	EventActivated       = "user.activated"
	EventDeactivated     = "user.deactivated"
	EventPasswordChanged = "user.password_changed"
	EventPasswordReset   = "user.password_reset"
	EventDeleted         = "user.deleted"
	auditEntity          = "user"
)

func (s *Service) event(actor uuid.UUID, name string, id uuid.UUID, at time.Time, before, after any) (audit.Event, error) {
	return audit.New(s.newID(), &actor, name, auditEntity, id, at, before, after)
}

// Sessions ends a user's sign-ins (the session service, through an adapter in
// cmd/api/checkers.go). reason is one of the End* values.
type Sessions interface {
	EndAll(ctx context.Context, userID, keep uuid.UUID, reason string) error
}

// Why a user's sign-ins end, as the session service records it.
const (
	EndPasswordChanged = "password_changed"
	EndPasswordReset   = "password_reset"
	EndDeactivated     = "deactivated"
	EndDeleted         = "deleted"
)

type noSessions struct{}

func (noSessions) EndAll(context.Context, uuid.UUID, uuid.UUID, string) error { return nil }

// noRoles knows no roles: every id is accepted and grants nothing, so nothing
// is refused for permissions. Production always passes WithRoles.
type noRoles struct{}

func (noRoles) Permissions(context.Context, []uuid.UUID) ([]role.Permission, error) { return nil, nil }
func (noRoles) PermissionsOf(context.Context, uuid.UUID) ([]role.Permission, error) { return nil, nil }
func (noRoles) Missing(context.Context, []uuid.UUID) ([]uuid.UUID, error)           { return nil, nil }

// Service owns user policy: validation, IDs, timestamps and password hashing,
// and who may give which roles to whom.
type Service struct {
	repo     Repository
	sessions Sessions
	roles    Roles
	// guard is the role some active user must always hold (WithGuardRole).
	guard  uuid.UUID
	now    func() time.Time
	newID  func() uuid.UUID
	hash   func(password string) (string, error)
	verify func(hash, password string) bool
	// dummyHash is compared against when no user matches, so a login for an
	// unknown email costs the same as one with a wrong password.
	dummyHash string
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

// WithSessions ends a user's sign-ins when their password changes or the
// account is deactivated or deleted. Without it nothing is ended.
func WithSessions(sessions Sessions) Option { return func(s *Service) { s.sessions = sessions } }

// WithRoles checks role ids and permissions against the role service: a user
// may give, take away or manage only what their own roles allow.
func WithRoles(roles Roles) Option { return func(s *Service) { s.roles = roles } }

// WithGuardRole keeps at least one active user holding role id (the
// Administrator): a change that would leave none is ErrLastAdministrator.
func WithGuardRole(id uuid.UUID) Option { return func(s *Service) { s.guard = id } }

// WithHasher replaces bcrypt, which is deliberately slow, in tests.
func WithHasher(hash func(string) (string, error), verify func(hash, password string) bool) Option {
	return func(s *Service) { s.hash, s.verify = hash, verify }
}

func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{
		repo:     repo,
		sessions: noSessions{},
		roles:    noRoles{},
		now:      func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) },
		newID:    uuid.New,
		hash:     bcryptHash,
		verify:   bcryptVerify,
	}
	for _, o := range opts {
		o(s)
	}
	s.dummyHash, _ = s.hash("dummy-password-for-timing")
	return s
}

func bcryptHash(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

func bcryptVerify(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

// Create adds a user on behalf of actor.
func (s *Service) Create(ctx context.Context, p CreateParams, actor uuid.UUID) (User, error) {
	if actor == uuid.Nil {
		return User{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return User{}, err
	}
	if err := s.knownRoles(ctx, p.RoleIDs); err != nil {
		return User{}, err
	}
	if err := s.mayGrant(ctx, actor, p.RoleIDs); err != nil {
		return User{}, err
	}
	return s.create(ctx, p, func(uuid.UUID) uuid.UUID { return actor })
}

// Bootstrap creates a user holding roleIDs (the first administrator),
// attributed to itself. It exists for the first account, when there is no
// other user to act as the creator.
func (s *Service) Bootstrap(ctx context.Context, email, name, password string, roleIDs []uuid.UUID) (User, error) {
	p := CreateParams{Email: email, Name: name, Password: password, RoleIDs: roleIDs}
	if err := p.Validate(); err != nil {
		return User{}, err
	}
	if err := s.knownRoles(ctx, p.RoleIDs); err != nil {
		return User{}, err
	}
	return s.create(ctx, p, func(self uuid.UUID) uuid.UUID { return self })
}

// knownRoles refuses ids that name no live role.
func (s *Service) knownRoles(ctx context.Context, ids []uuid.UUID) error {
	missing, err := s.roles.Missing(ctx, ids)
	if err != nil {
		return err
	}
	if len(missing) > 0 {
		return fieldError("role_ids", "contains unknown role "+missing[0].String())
	}
	return nil
}

// mayGrant refuses giving or taking away roleIDs when the actor may not grant
// what they hold (role.MayGrant): only whoever manages roles may grant any
// permission; anyone else only what their own roles allow.
func (s *Service) mayGrant(ctx context.Context, actor uuid.UUID, roleIDs []uuid.UUID) error {
	if len(roleIDs) == 0 {
		return nil
	}
	perms, err := s.roles.Permissions(ctx, roleIDs)
	if err != nil {
		return err
	}
	mine, err := s.roles.PermissionsOf(ctx, actor)
	if err != nil {
		return err
	}
	if !role.MayGrant(perms, mine) {
		return ErrNotPermitted
	}
	return nil
}

func (s *Service) create(ctx context.Context, p CreateParams, actorFor func(self uuid.UUID) uuid.UUID) (User, error) {
	hash, err := s.hash(p.Password)
	if err != nil {
		return User{}, err
	}
	now := s.now()
	id := s.newID()
	actor := actorFor(id)
	u := User{
		ID:              id,
		Email:           p.Email,
		Name:            p.Name,
		PasswordHash:    hash,
		RoleIDs:         p.RoleIDs,
		IsActive:        true,
		Language:        LangEnglish,
		CreatedAt:       now,
		UpdatedAt:       now,
		CreatedByUserID: actor,
		UpdatedByUserID: actor,
	}
	ev, err := s.event(actor, EventCreated, id, now, nil, map[string]any{
		"name": u.Name, "email": u.Email, "role_ids": u.RoleIDs, "is_active": u.IsActive})
	if err != nil {
		return User{}, err
	}
	if err := s.repo.Create(ctx, u, ev); err != nil {
		return User{}, err
	}
	return u, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (User, error) {
	return s.repo.Get(ctx, id)
}

func (s *Service) ByEmail(ctx context.Context, email string) (User, error) {
	return s.repo.ByEmail(ctx, normalizeEmail(email))
}

func (s *Service) List(ctx context.Context) ([]User, error) {
	return s.repo.List(ctx)
}

// Update replaces the profile fields of user id. Unless the actor manages
// roles, they may manage only a user whose roles grant nothing beyond the
// actor's own, and give or take away only such roles. An actor cannot deactivate themselves or take
// managing users or roles away from themselves, which would lock them out
// mid-session. Deactivating a user ends their sign-ins; a role change reaches
// them at their next refresh. Each kind of change is recorded:
// user.updated (name, email), user.roles_changed, user.activated/deactivated.
func (s *Service) Update(ctx context.Context, id uuid.UUID, p UpdateParams, actor uuid.UUID) (User, error) {
	if actor == uuid.Nil {
		return User{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return User{}, err
	}
	u, err := s.repo.Get(ctx, id)
	if err != nil {
		return User{}, err
	}
	if err := s.knownRoles(ctx, p.RoleIDs); err != nil {
		return User{}, err
	}
	if err := s.mayGrant(ctx, actor, append(slices.Clone(u.RoleIDs), changedRoles(u.RoleIDs, p.RoleIDs)...)); err != nil {
		return User{}, err
	}
	if id == actor {
		if !p.IsActive {
			return User{}, fieldError("is_active", "cannot be false for your own account")
		}
		if err := s.keepsOwnAccess(ctx, actor, p.RoleIDs); err != nil {
			return User{}, err
		}
	}
	now := s.now()
	var evs []audit.Event
	add := func(name string, before, after any) error {
		ev, err := s.event(actor, name, id, now, before, after)
		if err == nil {
			evs = append(evs, ev)
		}
		return err
	}
	before, after := map[string]any{}, map[string]any{}
	if u.Name != p.Name {
		before["name"], after["name"] = u.Name, p.Name
	}
	if u.Email != p.Email {
		before["email"], after["email"] = u.Email, p.Email
	}
	if len(after) > 0 {
		if err := add(EventUpdated, before, after); err != nil {
			return User{}, err
		}
	}
	if !slices.Equal(u.RoleIDs, p.RoleIDs) {
		if err := add(EventRolesChanged, map[string]any{"role_ids": u.RoleIDs}, map[string]any{"role_ids": p.RoleIDs}); err != nil {
			return User{}, err
		}
	}
	if u.IsActive != p.IsActive {
		name := EventDeactivated
		if p.IsActive {
			name = EventActivated
		}
		if err := add(name, nil, nil); err != nil {
			return User{}, err
		}
	}
	deactivated := u.IsActive && !p.IsActive
	u.Email = p.Email
	u.Name = p.Name
	u.RoleIDs = p.RoleIDs
	u.IsActive = p.IsActive
	u.UpdatedAt = now
	u.UpdatedByUserID = actor
	if err := s.repo.Update(ctx, u, s.guard, evs); err != nil {
		return User{}, err
	}
	if deactivated {
		if err := s.sessions.EndAll(ctx, id, uuid.Nil, EndDeactivated); err != nil {
			return User{}, err
		}
	}
	return u, nil
}

// keepsOwnAccess refuses the actor's own new roles when they would drop
// managing users or roles, which the actor holds now.
func (s *Service) keepsOwnAccess(ctx context.Context, actor uuid.UUID, roleIDs []uuid.UUID) error {
	mine, err := s.roles.PermissionsOf(ctx, actor)
	if err != nil {
		return err
	}
	after, err := s.roles.Permissions(ctx, roleIDs)
	if err != nil {
		return err
	}
	for _, keep := range []role.Permission{role.UsersManage, role.RolesManage} {
		if slices.Contains(mine, keep) && !slices.Contains(after, keep) {
			return fieldError("role_ids", "cannot take "+string(keep)+" from your own account")
		}
	}
	return nil
}

// changedRoles are the ids in one of a and b and not the other.
func changedRoles(a, b []uuid.UUID) []uuid.UUID {
	var out []uuid.UUID
	for _, id := range a {
		if !slices.Contains(b, id) {
			out = append(out, id)
		}
	}
	for _, id := range b {
		if !slices.Contains(a, id) {
			out = append(out, id)
		}
	}
	return out
}

// mayManage refuses managing user id (resetting their password, deleting
// them) when the actor may not grant what their roles hold: a user who
// manages users but not roles cannot take over an administrator's account.
// MayManage is nil when actor may manage user id (ending their sessions on
// Security, as well as the changes here): ErrNotPermitted when id holds
// permissions actor does not, ErrNotFound when there is no such user.
func (s *Service) MayManage(ctx context.Context, id, actor uuid.UUID) error {
	return s.mayManage(ctx, id, actor)
}

func (s *Service) mayManage(ctx context.Context, id, actor uuid.UUID) error {
	u, err := s.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	return s.mayGrant(ctx, actor, u.RoleIDs)
}

// SetPassword replaces a user's password without knowing the old one (admin
// reset), and ends every sign-in of theirs.
func (s *Service) SetPassword(ctx context.Context, id uuid.UUID, password string, actor uuid.UUID) error {
	if actor != uuid.Nil {
		if err := s.mayManage(ctx, id, actor); err != nil {
			return err
		}
	}
	if err := s.setPassword(ctx, id, password, actor, EventPasswordReset); err != nil {
		return err
	}
	return s.sessions.EndAll(ctx, id, uuid.Nil, EndPasswordReset)
}

// setPassword stores password's hash and records event (password_reset or
// _changed), which holds no value.
func (s *Service) setPassword(ctx context.Context, id uuid.UUID, password string, actor uuid.UUID, event string) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	if err := validatePassword(password); err != nil {
		return err
	}
	hash, err := s.hash(password)
	if err != nil {
		return err
	}
	now := s.now()
	ev, err := s.event(actor, event, id, now, nil, nil)
	if err != nil {
		return err
	}
	return s.repo.SetPasswordHash(ctx, id, hash, now, actor, ev)
}

// ChangePassword lets a user replace their own password after proving the
// current one. Their other sign-ins end; keep, the one they changed it in, stays.
func (s *Service) ChangePassword(ctx context.Context, self, keep uuid.UUID, current, next string) error {
	if err := s.CheckPassword(ctx, self, current); errors.Is(err, ErrInvalid) {
		return fieldError("current_password", "is incorrect")
	} else if err != nil {
		return err
	}
	if err := s.setPassword(ctx, self, next, self, EventPasswordChanged); err != nil {
		return err
	}
	return s.sessions.EndAll(ctx, self, keep, EndPasswordChanged)
}

// CheckPassword confirms the signed-in user's own password, before an action
// that asks for it again. A wrong one is ErrInvalid naming the password.
func (s *Service) CheckPassword(ctx context.Context, self uuid.UUID, password string) error {
	u, err := s.repo.Get(ctx, self)
	if err != nil {
		return err
	}
	if !s.verify(u.PasswordHash, password) {
		return fieldError("password", "is incorrect")
	}
	return nil
}

// SetLanguage sets the signed-in user's own interface language; no one sets
// another's. It returns the updated user.
func (s *Service) SetLanguage(ctx context.Context, self uuid.UUID, lang string) (User, error) {
	if self == uuid.Nil {
		return User{}, fieldError("actor", "is required")
	}
	if err := validateLanguage(lang); err != nil {
		return User{}, err
	}
	cur, err := s.repo.Get(ctx, self)
	if err != nil {
		return User{}, err
	}
	if cur.Language == lang {
		return cur, nil
	}
	now := s.now()
	ev, err := s.event(self, EventUpdated, self, now, map[string]any{"language": cur.Language}, map[string]any{"language": lang})
	if err != nil {
		return User{}, err
	}
	if err := s.repo.SetLanguage(ctx, self, lang, now, self, ev); err != nil {
		return User{}, err
	}
	return s.repo.Get(ctx, self)
}

// Delete soft-deletes user id and ends their sign-ins. Deleting your own
// account is refused.
func (s *Service) Delete(ctx context.Context, id uuid.UUID, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	if id == actor {
		return fieldError("id", "cannot delete your own account")
	}
	if err := s.mayManage(ctx, id, actor); err != nil {
		return err
	}
	now := s.now()
	ev, err := s.event(actor, EventDeleted, id, now, nil, nil)
	if err != nil {
		return err
	}
	if err := s.repo.Delete(ctx, id, now, actor, s.guard, ev); err != nil {
		return err
	}
	return s.sessions.EndAll(ctx, id, uuid.Nil, EndDeleted)
}

// Authenticate returns the active user matching email and password. Every
// failure — unknown email, wrong password, inactive account — is
// ErrInvalidCredentials, so the response does not reveal which accounts exist.
// It is a *SignInRefused saying which, for the security log.
func (s *Service) Authenticate(ctx context.Context, email, password string) (User, error) {
	u, err := s.repo.ByEmail(ctx, normalizeEmail(email))
	if errors.Is(err, ErrNotFound) {
		s.verify(s.dummyHash, password)
		return User{}, &SignInRefused{Reason: RefusedUnknownEmail}
	}
	if err != nil {
		return User{}, err
	}
	if !s.verify(u.PasswordHash, password) {
		return User{}, &SignInRefused{Reason: RefusedBadPassword, UserID: u.ID}
	}
	if !u.IsActive {
		return User{}, &SignInRefused{Reason: RefusedInactive, UserID: u.ID}
	}
	return u, nil
}
