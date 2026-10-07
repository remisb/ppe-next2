package order

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Snapshot is the current data read inside the Mark as Ordered transaction,
// under share locks, so it cannot change before the order commits.
type Snapshot struct {
	Employee EmployeeView
	// Items holds the live catalogue items among the requested ids; deleted or
	// unknown ids are absent.
	Items          map[uuid.UUID]ItemView
	PreparedByName string
	RecordSeq      int64
}

// Build turns a snapshot into the order to insert and its audit event. The
// service supplies it, so every rule stays in the service; a returned error
// aborts the transaction.
type Build func(s Snapshot) (Order, audit.Event, error)

// DeleteFunc turns the locked order into its deleted form and the event that
// records it; the service supplies it.
type DeleteFunc func(cur Order) (Order, audit.Event, error)

type Repository interface {
	// Create runs Mark as Ordered: in one transaction it share-locks the live
	// employee (ErrEmployeeNotFound) and the requested catalogue items, reads
	// the preparer's name (ErrActorNotFound), takes the next record number,
	// calls build, and inserts the order, its lines and the event.
	Create(ctx context.Context, employeeID uuid.UUID, itemIDs []uuid.UUID, preparer uuid.UUID, build Build) (Order, error)
	// Delete locks the live order (ErrNotFound), calls fn, and in one
	// transaction writes the deletion, revokes the order's unused links and
	// inserts the event. The row, lines and confirmations stay.
	Delete(ctx context.Context, id uuid.UUID, fn DeleteFunc) error
	// Get returns a live order with its lines, or ErrNotFound; so do List and
	// every other read: a deleted order is not there.
	Get(ctx context.Context, id uuid.UUID) (Order, error)
	// List returns one page of orders matching f, with their lines, newest
	// activity first, and the total number of matches.
	List(ctx context.Context, f ListFilter) ([]Order, int, error)

	// CreateLink locks the order (ErrNotFound), calls fn, revokes the order's
	// unused electronic links, and inserts the new link and its event.
	CreateLink(ctx context.Context, orderID uuid.UUID, fn LinkFunc) error
	// LinkByHash returns the confirmation with this token hash, or
	// ErrLinkExpired when there is none or its order is deleted (an unknown
	// link reads as expired).
	LinkByHash(ctx context.Context, tokenHash string) (Confirmation, error)
	// LinkOpened records link linkID's first opening at at, with ev, unless
	// it was opened before (then it writes nothing).
	LinkOpened(ctx context.Context, linkID uuid.UUID, at time.Time, ev audit.Event) error
	// Confirm locks the order (and linkID's link, when given), reads the
	// giver's name, calls fn, and unless it is a no-op writes the GIVEN order,
	// the confirmation evidence, the revocation of other unused links, and the
	// event, all in one transaction. It returns the resulting order.
	Confirm(ctx context.Context, orderID uuid.UUID, linkID *uuid.UUID, giver uuid.UUID, fn ConfirmFunc) (Order, error)
	// ConfirmedFor returns the confirmation holding the evidence of a GIVEN order.
	ConfirmedFor(ctx context.Context, orderID uuid.UUID) (Confirmation, error)
}
