package employee

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Mutation computes the new state of a row from its current, locked state and
// the audit events to record with it (none for none). The repository calls it
// inside the write transaction, so the "before" an event records is exactly
// what the write replaced. A returned error aborts the write.
type Mutation func(cur Employee) (Employee, []audit.Event, error)

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
	// IDByCode is the live employee with code (case-insensitive), if any.
	IDByCode(ctx context.Context, code string) (uuid.UUID, bool, error)

	// DistinctPairs are the pairs marked Not the Same Person, each as pairKey orders it.
	DistinctPairs(ctx context.Context) (map[[2]uuid.UUID]bool, error)
	// MarkDistinct records live employees a < b as two people, with evs; a
	// pair marked already is left as it is, without events. ErrNotFound when
	// either is not live.
	MarkDistinct(ctx context.Context, a, b, actor uuid.UUID, at time.Time, evs []audit.Event) error
	// MergeContents reads live keep and remove and what remove has.
	MergeContents(ctx context.Context, keepID, removeID uuid.UUID) (Employee, Employee, MergeContents, error)
	// Merge locks live keep and remove, applies m and, in one transaction,
	// moves remove's orders, assignments and photos (not as default when keep
	// has one) to keep, removes remove pointing at keep (and what was merged
	// into it), forgets its Not the Same Person marks, writes keep and the
	// events.
	Merge(ctx context.Context, keepID, removeID uuid.UUID, m MergeMutation) (Employee, error)
	// MergedInto is the record a removed employee was merged into, if it was.
	MergedInto(ctx context.Context, id uuid.UUID) (uuid.UUID, bool, error)
	// MergedFrom are the removed records merged into id.
	MergedFrom(ctx context.Context, id uuid.UUID) ([]uuid.UUID, error)
}
