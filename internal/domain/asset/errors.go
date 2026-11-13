package asset

import (
	"errors"
	"fmt"

	"github.com/google/uuid"
)

var (
	// ErrNotFound is an asset that is not live or that the reader may not
	// see (Seen), and an assignment (Form) or signed copy not the asset's.
	ErrNotFound = errors.New("asset not found")
	// ErrInvalid wraps every validation failure, naming the field.
	ErrInvalid = errors.New("invalid asset")
	// ErrActorNotFound is an acting user the actor foreign keys do not find.
	ErrActorNotFound = errors.New("acting user not found")
	// ErrEmployeeNotFound is a holder who is not a live employee.
	ErrEmployeeNotFound = errors.New("employee not found")
	// ErrNoForm is an asset or assignment without a form: one that needs none,
	// or (for a signed copy) an assignment given without one.
	ErrNoForm = errors.New("this assignment has no form")
	// ErrInventoryNoTaken and ErrSIMNoTaken come wrapped in a DuplicateError
	// naming the asset that has the number.
	ErrInventoryNoTaken = errors.New("inventory number already used")
	ErrSIMNoTaken       = errors.New("SIM number already registered")
	// ErrAlreadyGiven refuses giving an asset that has an open assignment.
	ErrAlreadyGiven = errors.New("asset already given to another employee")
	// ErrNotActive refuses giving a SIM card that is not Active.
	ErrNotActive = errors.New("SIM is not active")
	// ErrNotGiven refuses Return and Mark as Not Returned without an open assignment.
	ErrNotGiven = errors.New("asset is not given to anyone")
	// ErrAlreadyMarked refuses marking an assignment Not Returned twice.
	ErrAlreadyMarked = errors.New("asset is already marked as not returned")
	// ErrFormChanged refuses Give when the form built now differs from the
	// one printed (its hash), so the employee signed another.
	ErrFormChanged = errors.New("the form changed after it was printed")
	// ErrNotPermitted refuses Equipment & Furniture to a reader without
	// equipment.read (Sight.Check).
	ErrNotPermitted = errors.New("Equipment & Furniture needs the Equipment Assignments role")
	// ErrSIMsNotPermitted refuses SIM cards to a reader without sim_cards.read.
	ErrSIMsNotPermitted = errors.New("SIM cards need the permission See SIM Cards")
	// ErrMayNotChange: SIM cards need Manage SIMs (sim_cards.manage),
	// Equipment & Furniture Manage Equipment & Furniture (assets.manage).
	ErrMayNotChange = errors.New("your roles do not allow changing this kind of asset")
	// Signed copies (slice 5).
	ErrAssignmentNotFound = errors.New("assignment not found")
	ErrNoStorage          = errors.New("file storage is not set up, so signed copies cannot be kept")
	ErrFileType           = errors.New("a signed copy must be a PDF, JPEG or PNG file")
	ErrFileTooLarge       = errors.New("a signed copy may be at most 10 MB")
	// PIN and PUK (Scan SIMs).
	ErrNoSIMCodes          = errors.New("no PIN and PUK are recorded for this SIM")
	ErrSIMCodesUnavailable = errors.New("PIN and PUK cannot be kept or shown: the API has no API_SIM_CODES_KEY")
)

// fieldError is ErrInvalid for field, saying its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}

// DuplicateError is a number conflict with the asset that already has the
// number, so the app can open it (assets brief §4).
type DuplicateError struct {
	Err      error // ErrInventoryNoTaken or ErrSIMNoTaken
	Existing uuid.UUID
}

// Error is the sentinel's message.
func (e *DuplicateError) Error() string { return e.Err.Error() }

// Unwrap is the sentinel, so errors.Is sees ErrInventoryNoTaken or ErrSIMNoTaken.
func (e *DuplicateError) Unwrap() error { return e.Err }

// ExistingID is the asset that has the number, which the API answers as existing_id.
func (e *DuplicateError) ExistingID() uuid.UUID { return e.Existing }
