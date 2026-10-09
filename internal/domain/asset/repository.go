package asset

import (
	"context"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Record is an asset with its open assignment, nil when it has none.
type Record struct {
	Asset Asset
	Open  *Assignment
}

// Held is one of an employee's assignments, with its asset.
type Held struct {
	Assignment Assignment
	Asset      Asset
}

// Mutation computes an asset's new state from its current, locked state and
// the events to record with it. The repository calls it inside the write
// transaction; a returned error aborts the write.
type Mutation func(cur Asset, open *Assignment) (Asset, []audit.Event, error)

// GiveFunc builds the assignment for giving the locked asset to the
// share-locked employee, the asset's new state (a plan or value filled in)
// and the events. The service supplies it, so every rule stays there.
type GiveFunc func(cur Asset, open *Assignment, emp EmployeeView) (Asset, Assignment, []audit.Event, error)

// OpenMutation computes the open assignment's new state (returned, or marked
// Not Returned) from the locked asset and its open assignment, nil when there
// is none.
type OpenMutation func(cur Asset, open *Assignment) (Assignment, []audit.Event, error)

// Bump raises prefix's counter to at least N when an asset takes number N.
type Bump struct {
	Prefix string
	N      int64
}

// BumpOf is the counter a's inventory number raises: its prefix's own
// PREFIX-NNNNNN, or nil for any other number.
func BumpOf(a Asset) *Bump {
	if n := numberOf(a.Prefix(), a.InventoryNo); n > 0 {
		return &Bump{Prefix: a.Prefix(), N: n}
	}
	return nil
}

// Repository is the persistence the asset service needs. Reads return live
// assets that are not written off; implementations translate storage errors
// to this package's sentinels and never validate.
type Repository interface {
	// Create inserts a, records its number as used, raises the counter when
	// bump is set, and writes ev, in one transaction. A number in use is
	// ErrInventoryNoTaken; a live SIM number, ErrSIMNoTaken.
	Create(ctx context.Context, a Asset, bump *Bump, ev audit.Event) error
	Get(ctx context.Context, id uuid.UUID) (Record, error)
	// Assignments are the asset's assignments, newest first.
	Assignments(ctx context.Context, assetID uuid.UUID) ([]Assignment, error)
	List(ctx context.Context, f ListFilter) ([]Record, int, error)
	Summary(ctx context.Context, kind Kind) (Summary, error)
	// ByNumber matches q, spaces ignored, against SIM, phone and inventory
	// numbers, case-insensitively.
	ByNumber(ctx context.Context, q string, limit int) ([]Record, error)
	// ByEmployee is the employee's assignments, open first, then newest.
	ByEmployee(ctx context.Context, employeeID uuid.UUID) ([]Held, error)
	// Employee reads a live employee, or ErrEmployeeNotFound.
	Employee(ctx context.Context, id uuid.UUID) (EmployeeView, error)
	// LastNumber is prefix's counter, 0 before its first number.
	LastNumber(ctx context.Context, prefix string) (int64, error)
	// NumberOwner is the asset that used number, compared case-insensitively,
	// or ErrNotFound when no asset ever did.
	NumberOwner(ctx context.Context, number string) (uuid.UUID, error)
	// SIMOwner is the live asset with SIM number simNo, spaces ignored, or ErrNotFound.
	SIMOwner(ctx context.Context, simNo string) (uuid.UUID, error)
	// Update locks the asset and its open assignment, applies m and writes the
	// asset (recording a new inventory number as used) and its events.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (Record, error)
	// Give locks the asset and its open assignment, share-locks the live
	// employee (ErrEmployeeNotFound), calls fn, and writes the asset, the new
	// assignment and the events. A second open assignment is ErrAlreadyGiven.
	Give(ctx context.Context, assetID, employeeID uuid.UUID, fn GiveFunc) (Assignment, error)
	// UpdateOpen locks the asset and its open assignment, calls fn and writes
	// the assignment's return and Not Returned fields and the events.
	UpdateOpen(ctx context.Context, assetID uuid.UUID, fn OpenMutation) (Assignment, error)
}
