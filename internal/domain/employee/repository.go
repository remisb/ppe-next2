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
// translate storage errors to this package's sentinels (ErrNotFound,
// ErrCodeTaken, ErrActorNotFound, ErrInvalid) and never validate. Employees
// read are live ones, with the derived DefaultPhotoID and the identity fields
// filled; MergedInto and MergedFrom alone look at removed records.
type Repository interface {
	// Create inserts e and its event (none when ev is nil) in one transaction;
	// ErrCodeTaken when a live employee has e's code.
	Create(ctx context.Context, e Employee, ev *audit.Event) error
	// Get is live employee id; ErrNotFound when it is missing, deleted or
	// merged away.
	Get(ctx context.Context, id uuid.UUID) (Employee, error)
	// List is every live employee, by last then first name (case-insensitive),
	// then id; [] when there are none.
	List(ctx context.Context) ([]Employee, error)
	// SearchByName matches q case-insensitively, as a literal substring,
	// against first name, last name, full name and code, among live employees,
	// in List's order, at most limit.
	SearchByName(ctx context.Context, q string, limit int) ([]Employee, error)
	// Update locks live row id FOR UPDATE, applies m and writes the result
	// (a soft delete included) and its events in one transaction; ErrNotFound
	// when id is not live, and m's error as it is.
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
