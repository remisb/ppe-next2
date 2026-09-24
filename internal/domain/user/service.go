package user

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// Service owns user policy: validation, IDs, timestamps and password hashing.
type Service struct {
	repo   Repository
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

// WithHasher replaces bcrypt, which is deliberately slow, in tests.
func WithHasher(hash func(string) (string, error), verify func(hash, password string) bool) Option {
	return func(s *Service) { s.hash, s.verify = hash, verify }
}

func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{
		repo:   repo,
		now:    func() time.Time { return time.Now().UTC() },
		newID:  uuid.New,
		hash:   bcryptHash,
		verify: bcryptVerify,
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
	return s.create(ctx, p, func(uuid.UUID) uuid.UUID { return actor })
}

// Bootstrap creates an admin attributed to itself. It exists for the first
// account, when there is no other user to act as the creator.
func (s *Service) Bootstrap(ctx context.Context, email, name, password string) (User, error) {
	p := CreateParams{Email: email, Name: name, Password: password, Roles: []string{RoleAdmin}}
	return s.create(ctx, p, func(self uuid.UUID) uuid.UUID { return self })
}

func (s *Service) create(ctx context.Context, p CreateParams, actorFor func(self uuid.UUID) uuid.UUID) (User, error) {
	if err := p.Validate(); err != nil {
		return User{}, err
	}
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
		Roles:           p.Roles,
		IsActive:        true,
		CreatedAt:       now,
		UpdatedAt:       now,
		CreatedByUserID: actor,
		UpdatedByUserID: actor,
	}
	if err := s.repo.Create(ctx, u); err != nil {
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

// Update replaces the profile fields of user id. An actor cannot deactivate
// themselves or drop their own admin role, which would lock them out mid-session.
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
	if id == actor {
		if !p.IsActive {
			return User{}, fieldError("is_active", "cannot be false for your own account")
		}
		if u.HasRole(RoleAdmin) && !slices.Contains(p.Roles, RoleAdmin) {
			return User{}, fieldError("roles", "cannot remove admin from your own account")
		}
	}
	u.Email = p.Email
	u.Name = p.Name
	u.Roles = p.Roles
	u.IsActive = p.IsActive
	u.UpdatedAt = s.now()
	u.UpdatedByUserID = actor
	if err := s.repo.Update(ctx, u); err != nil {
		return User{}, err
	}
	return u, nil
}

// SetPassword replaces a user's password without knowing the old one (admin reset).
func (s *Service) SetPassword(ctx context.Context, id uuid.UUID, password string, actor uuid.UUID) error {
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
	return s.repo.SetPasswordHash(ctx, id, hash, s.now(), actor)
}

// ChangePassword lets a user replace their own password after proving the current one.
func (s *Service) ChangePassword(ctx context.Context, self uuid.UUID, current, next string) error {
	u, err := s.repo.Get(ctx, self)
	if err != nil {
		return err
	}
	if !s.verify(u.PasswordHash, current) {
		return fieldError("current_password", "is incorrect")
	}
	return s.SetPassword(ctx, self, next, self)
}

// Delete soft-deletes user id. Deleting your own account is refused.
func (s *Service) Delete(ctx context.Context, id uuid.UUID, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	if id == actor {
		return fieldError("id", "cannot delete your own account")
	}
	return s.repo.Delete(ctx, id, s.now(), actor)
}

// Authenticate returns the active user matching email and password. Every
// failure — unknown email, wrong password, inactive account — is
// ErrInvalidCredentials, so the response does not reveal which accounts exist.
func (s *Service) Authenticate(ctx context.Context, email, password string) (User, error) {
	u, err := s.repo.ByEmail(ctx, normalizeEmail(email))
	if errors.Is(err, ErrNotFound) {
		s.verify(s.dummyHash, password)
		return User{}, ErrInvalidCredentials
	}
	if err != nil {
		return User{}, err
	}
	if !s.verify(u.PasswordHash, password) || !u.IsActive {
		return User{}, ErrInvalidCredentials
	}
	return u, nil
}
