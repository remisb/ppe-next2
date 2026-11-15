package supplier

import (
	"context"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Mutation computes a supplier's new state from its current, locked state
// plus the audit events to record (none for none).
type Mutation func(cur Supplier) (Supplier, []audit.Event, error)

// Repository is the persistence the supplier service needs. Its reads return
// live suppliers only (a deleted one is ErrNotFound), each with its live items
// counted. Implementations translate storage errors to this package's
// sentinels and never validate.
type Repository interface {
	// Create stores s and ev in one transaction and returns s as read back; a
	// live supplier's code is ErrCodeTaken.
	Create(ctx context.Context, s Supplier, ev audit.Event) (Supplier, error)
	// Get is the live supplier, or ErrNotFound.
	Get(ctx context.Context, id uuid.UUID) (Supplier, error)
	// List returns every live supplier by name, then code.
	List(ctx context.Context) ([]Supplier, error)
	// Update locks the live supplier (ErrNotFound), applies m and, when m
	// returns events, writes the supplier with them (Delete is an Update that
	// sets DeletedAt); no events writes nothing. It returns the supplier as
	// read back.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (Supplier, error)
}
