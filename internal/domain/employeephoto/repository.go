package employeephoto

import (
	"context"
	"io"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Change computes an employee's photos after a change from their current live
// ones (oldest first) and the events to record. A photo that is removed comes
// back with DeletedAt set; one that is not returned is left as it is.
type Change func(cur []Photo) (next []Photo, evs []audit.Event, err error)

// Repository is the persistence the service needs.
type Repository interface {
	// List is the employee's live photos, oldest first; ErrEmployeeNotFound for none.
	List(ctx context.Context, employeeID uuid.UUID) ([]Photo, error)
	// Photo is one live photo of the employee, or ErrNotFound.
	Photo(ctx context.Context, employeeID, photoID uuid.UUID) (Photo, error)
	// Apply locks the live employee (ErrEmployeeNotFound), reads their live
	// photos, calls fn and writes what it returns and its events in one transaction.
	Apply(ctx context.Context, employeeID uuid.UUID, fn Change) error
}

// ReadCloser is what Open returns.
type ReadCloser = io.ReadCloser
