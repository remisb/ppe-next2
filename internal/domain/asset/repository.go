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

// Repository is the persistence the asset service needs. Reads of assets
// return live ones, neither deleted nor written off, except ByEmployee, which
// keeps every assignment the employee had, and SIMOwner and SIMOwners, which
// compare as the unique SIM No. index does (not deleted). Implementations
// translate storage errors to this package's sentinels and never validate.
type Repository interface {
	// Create inserts a, records its number as used, raises the counter when
	// bump is set, and writes ev, in one transaction. A number in use is
	// ErrInventoryNoTaken; a live SIM number, ErrSIMNoTaken.
	Create(ctx context.Context, a Asset, bump *Bump, ev audit.Event) error
	// Get is the live asset with its open assignment, or ErrNotFound.
	Get(ctx context.Context, id uuid.UUID) (Record, error)
	// Assignments are the asset's assignments, newest given date first, each
	// with its signed copies, newest first.
	Assignments(ctx context.Context, assetID uuid.UUID) ([]Assignment, error)
	// List is f's page of the register and how many assets f matches in all.
	List(ctx context.Context, f ListFilter) ([]Record, int, error)
	// Summary counts kind's live assets for the register's tiles and lists
	// their providers.
	Summary(ctx context.Context, kind Kind) (Summary, error)
	// ByNumber matches q, spaces ignored, against SIM, phone and inventory
	// numbers, case-insensitively, among assets of kinds, by inventory
	// number, at most limit.
	ByNumber(ctx context.Context, q string, kinds []Kind, limit int) ([]Record, error)
	// ByEmployee is the employee's assignments, open first, then newest.
	ByEmployee(ctx context.Context, employeeID uuid.UUID) ([]Held, error)
	// Employee reads a live employee, or ErrEmployeeNotFound.
	Employee(ctx context.Context, id uuid.UUID) (EmployeeView, error)
	// LastNumber is prefix's counter, 0 before its first number.
	LastNumber(ctx context.Context, prefix string) (int64, error)
	// NumberOwner is the asset that used number, compared case-insensitively,
	// or ErrNotFound when no asset ever did.
	NumberOwner(ctx context.Context, number string) (uuid.UUID, error)
	// SIMOwner is the live asset with SIM number simNo, as simKey compares
	// it, or ErrNotFound.
	SIMOwner(ctx context.Context, simNo string) (uuid.UUID, error)
	// SIMOwners are the live assets whose SIM numbers' simKey is among keys,
	// by key.
	SIMOwners(ctx context.Context, keys []string) (map[string]uuid.UUID, error)
	// SIMCodes are the live SIM card's sealed PIN and PUK with its SIM No.;
	// ErrNotFound when there is no such card, ErrNoSIMCodes when it has none.
	SIMCodes(ctx context.Context, assetID uuid.UUID) (SealedCodes, error)
	// PutSIMCodes keeps c in place of the asset's codes, and ev, in one transaction.
	PutSIMCodes(ctx context.Context, c SealedCodes, ev audit.Event) error
	// SIMCodesNotUnder lists the cards' sealed codes kept under a key other
	// than keyID, of cards after the id after, in id order, at most limit
	// (SimNo not read).
	SIMCodesNotUnder(ctx context.Context, keyID int16, after uuid.UUID, limit int) ([]SealedCodes, error)
	// ResealSIMCodes keeps c's sealed codes and key in place of the card's
	// when they are still old, keeping who set them and when; false when
	// they were changed or forgotten meanwhile.
	ResealSIMCodes(ctx context.Context, c SealedCodes, old []byte) (bool, error)
	// DeleteSIMCodes forgets the asset's codes and writes ev, or is
	// ErrNoSIMCodes when it has none.
	DeleteSIMCodes(ctx context.Context, assetID uuid.UUID, ev audit.Event) error
	// Update locks the asset and its open assignment, applies m and, when m
	// returns events, writes the asset (recording a new inventory number as
	// used) and them; no events writes nothing.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (Record, error)
	// Give locks the asset and its open assignment, share-locks the live
	// employee (ErrEmployeeNotFound), calls fn, and writes the asset (when fn
	// changed it), the new assignment and the events. A second open
	// assignment is ErrAlreadyGiven.
	Give(ctx context.Context, assetID, employeeID uuid.UUID, fn GiveFunc) (Assignment, error)
	// ImportSIMs writes each item as Create does, its codes and its
	// assignment, the holder share-locked as Give does, in one transaction,
	// kept only when commit is set. An item's failure is an *ImportRowError
	// with its index.
	ImportSIMs(ctx context.Context, items []Imported, commit bool) error
	// UpdateOpen locks the asset and its open assignment, calls fn and writes
	// the assignment's return and Not Returned fields and the events.
	UpdateOpen(ctx context.Context, assetID uuid.UUID, fn OpenMutation) (Assignment, error)
	// AddSignedCopy locks the asset, reads its assignment (ErrAssignmentNotFound),
	// calls fn and writes the signed copy and its event.
	AddSignedCopy(ctx context.Context, assetID, assignmentID uuid.UUID, fn SignedCopyFunc) error
	// Record writes ev alone: an action on the asset that changes nothing.
	Record(ctx context.Context, ev audit.Event) error
	// SignedCopy is one signed copy of the asset's assignment, or ErrNotFound.
	SignedCopy(ctx context.Context, assetID, assignmentID, copyID uuid.UUID) (SignedCopy, error)
}
