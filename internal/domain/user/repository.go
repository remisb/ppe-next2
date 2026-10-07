package user

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/role"
)

// Repository is the persistence the user service needs. Implementations only
// read and write rows; they translate storage errors into this package's
// sentinels and never validate or invent values.
//
// guard is a role at least one active, live user must still hold after an
// Update or Delete (the Administrator); the write is rolled back with
// ErrLastAdministrator otherwise. uuid.Nil checks nothing.
type Repository interface {
	// Every write records its audit events in the same transaction.

	// Create writes the user, the roles they hold, and ev.
	Create(ctx context.Context, u User, ev audit.Event) error
	Get(ctx context.Context, id uuid.UUID) (User, error)
	// ByEmail matches case-insensitively among live users.
	ByEmail(ctx context.Context, email string) (User, error)
	List(ctx context.Context) ([]User, error)
	// Update writes email, name, roles, is_active, updated_at and updated_by,
	// and evs (none for none).
	Update(ctx context.Context, u User, guard uuid.UUID, evs []audit.Event) error
	SetPasswordHash(ctx context.Context, id uuid.UUID, hash string, at time.Time, by uuid.UUID, ev audit.Event) error
	// SetLanguage sets a live user's interface language, or ErrNotFound.
	SetLanguage(ctx context.Context, id uuid.UUID, lang string, at time.Time, by uuid.UUID, ev audit.Event) error
	Delete(ctx context.Context, id uuid.UUID, at time.Time, by uuid.UUID, guard uuid.UUID, ev audit.Event) error
}

// Roles is what the user service asks about roles (the role service).
type Roles interface {
	// Permissions are those the live roles among ids grant.
	Permissions(ctx context.Context, ids []uuid.UUID) ([]role.Permission, error)
	// PermissionsOf are what user id's roles grant now.
	PermissionsOf(ctx context.Context, userID uuid.UUID) ([]role.Permission, error)
	// Missing returns the ids that name no live role.
	Missing(ctx context.Context, ids []uuid.UUID) ([]uuid.UUID, error)
}
