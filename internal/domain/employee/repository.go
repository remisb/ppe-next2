package employee

import (
	"context"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Mutation computes the new state of a row from its current, locked state and
// the audit event to record with it (nil for none). The repository calls it
// inside the write transaction, so the "before" an event records is exactly
// what the write replaced. A returned error aborts the write.
type Mutation func(cur Employee) (Employee, *audit.Event, error)

// Repository is the persistence the employee service needs. Implementations
// translate storage errors to this package's sentinels and never validate.
type Repository interface {
	Create(ctx context.Context, e Employee, ev *audit.Event) error
	Get(ctx context.Context, id uuid.UUID) (Employee, error)
	List(ctx context.Context) ([]Employee, error)
	// SearchByName matches q case-insensitively against first name, last name,
	// full name and code, among live employees.
	SearchByName(ctx context.Context, q string, limit int) ([]Employee, error)
	// Update locks live row id, applies m and writes the result and its event.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (Employee, error)
}
