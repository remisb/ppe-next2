package role

import (
	"context"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Audit events, entity type "role".
const (
	auditEntity  = "role"
	EventCreated = "role.created"
	EventUpdated = "role.updated"
	EventDeleted = "role.deleted"
)

// Service owns role policy: validation, the built-in roles' rules, and that
// no one grants a permission they do not hold.
type Service struct {
	repo  Repository
	now   func() time.Time
	newID func() uuid.UUID
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{repo: repo, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New}
	for _, o := range opts {
		o(s)
	}
	return s
}

// snapshot is what an audit event records of a role.
type snapshot struct {
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Permissions []Permission `json:"permissions"`
}

func snapshotOf(r Role) snapshot {
	return snapshot{Name: r.Name, Description: r.Description, Permissions: r.Permissions}
}

func (s *Service) event(actor uuid.UUID, name string, id uuid.UUID, at time.Time, before, after any) (*audit.Event, error) {
	ev, err := audit.New(s.newID(), &actor, name, auditEntity, id, at, before, after)
	if err != nil {
		return nil, err
	}
	return &ev, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Role, error) { return s.repo.Get(ctx, id) }
func (s *Service) List(ctx context.Context) ([]Role, error)            { return s.repo.List(ctx) }

// Permissions are what holding the roles ids grants: a user's, for their token.
func (s *Service) Permissions(ctx context.Context, ids []uuid.UUID) ([]Permission, error) {
	return s.repo.Permissions(ctx, ids)
}

// PermissionsOf is what user id's roles grant now, read from the database.
func (s *Service) PermissionsOf(ctx context.Context, userID uuid.UUID) ([]Permission, error) {
	roles, err := s.repo.OfUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return union(roles, uuid.Nil, nil), nil
}

// Missing returns the ids that name no live role.
func (s *Service) Missing(ctx context.Context, ids []uuid.UUID) ([]uuid.UUID, error) {
	return s.repo.Missing(ctx, ids)
}

// union is the permissions of roles, with role replace's replaced by with
// (uuid.Nil replaces none).
func union(roles []Role, replace uuid.UUID, with []Permission) []Permission {
	var all []string
	for _, r := range roles {
		perms := r.Permissions
		if r.ID == replace {
			perms = with
		}
		all = append(all, Strings(perms)...)
	}
	return Known(all)
}

// Create adds a role. The actor must be one who may grant its permissions (MayGrant).
func (s *Service) Create(ctx context.Context, p Params, actor uuid.UUID) (Role, error) {
	if actor == uuid.Nil {
		return Role{}, fieldError("actor", "is required")
	}
	perms, err := p.Validate()
	if err != nil {
		return Role{}, err
	}
	mine, err := s.PermissionsOf(ctx, actor)
	if err != nil {
		return Role{}, err
	}
	if !MayGrant(perms, mine) {
		return Role{}, ErrNotPermitted
	}
	now := s.now()
	r := Role{
		ID: s.newID(), Name: p.Name, Description: p.Description, Permissions: perms,
		CreatedAt: now, UpdatedAt: now, CreatedByUserID: &actor, UpdatedByUserID: &actor,
	}
	ev, err := s.event(actor, EventCreated, r.ID, now, nil, snapshotOf(r))
	if err != nil {
		return Role{}, err
	}
	if err := s.repo.Create(ctx, r, ev); err != nil {
		return Role{}, err
	}
	return r, nil
}

// Update replaces a role's name, description and permissions. Administrator
// cannot be changed; a built-in role keeps its name. The actor must be one
// who may grant every permission added or removed (MayGrant), and cannot take
// managing users or roles away from themselves.
func (s *Service) Update(ctx context.Context, id uuid.UUID, p Params, actor uuid.UUID) (Role, error) {
	if actor == uuid.Nil {
		return Role{}, fieldError("actor", "is required")
	}
	perms, err := p.Validate()
	if err != nil {
		return Role{}, err
	}
	held, err := s.repo.OfUser(ctx, actor)
	if err != nil {
		return Role{}, err
	}
	mine := union(held, uuid.Nil, nil)
	return s.repo.Update(ctx, id, func(cur Role) (Role, *audit.Event, error) {
		if cur.Locked {
			return Role{}, nil, ErrBuiltIn
		}
		if cur.Builtin() && p.Name != cur.Name {
			return Role{}, nil, fieldError("name", "of a built-in role cannot change")
		}
		if !MayGrant(changed(cur.Permissions, perms), mine) {
			return Role{}, nil, ErrNotPermitted
		}
		after := union(held, id, perms)
		for _, keep := range []Permission{UsersManage, RolesManage} {
			if slices.Contains(mine, keep) && !slices.Contains(after, keep) {
				return Role{}, nil, fieldError("permissions", "cannot take "+string(keep)+" from yourself")
			}
		}
		now := s.now()
		next := cur
		next.Name, next.Description, next.Permissions = p.Name, p.Description, perms
		next.UpdatedAt, next.UpdatedByUserID = now, &actor
		before, afterSnap := snapshotOf(cur), snapshotOf(next)
		if before.Name == afterSnap.Name && before.Description == afterSnap.Description && slices.Equal(before.Permissions, afterSnap.Permissions) {
			return next, nil, nil
		}
		ev, err := s.event(actor, EventUpdated, id, now, before, afterSnap)
		return next, ev, err
	})
}

// Delete soft-deletes a role no live user holds. Built-in roles stay.
func (s *Service) Delete(ctx context.Context, id uuid.UUID, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	_, err := s.repo.Update(ctx, id, func(cur Role) (Role, *audit.Event, error) {
		switch {
		case cur.Locked:
			return Role{}, nil, ErrBuiltIn
		case cur.Builtin():
			return Role{}, nil, fieldError("id", "names a built-in role, which cannot be deleted")
		case cur.UserCount > 0:
			return Role{}, nil, ErrInUse
		}
		now := s.now()
		next := cur
		next.DeletedAt, next.DeletedByUserID = &now, &actor
		next.UpdatedAt, next.UpdatedByUserID = now, &actor
		ev, err := s.event(actor, EventDeleted, id, now, snapshotOf(cur), nil)
		return next, ev, err
	})
	return err
}

// changed is the permissions in one of a and b and not the other.
func changed(a, b []Permission) []Permission {
	var out []Permission
	for _, p := range a {
		if !slices.Contains(b, p) {
			out = append(out, p)
		}
	}
	for _, p := range b {
		if !slices.Contains(a, p) {
			out = append(out, p)
		}
	}
	return out
}
