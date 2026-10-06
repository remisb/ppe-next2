package role

import (
	"context"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Mutation computes the new state of a role from its current, locked state
// (with its UserCount read under the lock) and the audit event to record. The
// repository calls it inside the write transaction; an error aborts the write.
type Mutation func(cur Role) (Role, *audit.Event, error)

// Repository stores roles with their permissions. Implementations translate
// storage errors to this package's sentinels and never validate.
type Repository interface {
	Create(ctx context.Context, r Role, ev *audit.Event) error
	Get(ctx context.Context, id uuid.UUID) (Role, error)
	// List returns live roles: built-ins first (admin, manager, employee), then by name.
	List(ctx context.Context) ([]Role, error)
	// Update locks live role id, applies m and writes the role, its
	// permissions and the event. A role being deleted is written with
	// DeletedAt set.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (Role, error)
	// Permissions are those of the live roles among ids, in catalogue order.
	Permissions(ctx context.Context, ids []uuid.UUID) ([]Permission, error)
	// OfUser returns the live roles user id holds.
	OfUser(ctx context.Context, userID uuid.UUID) ([]Role, error)
	// Missing returns the ids that name no live role.
	Missing(ctx context.Context, ids []uuid.UUID) ([]uuid.UUID, error)
}
