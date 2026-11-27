package asset

import (
	"fmt"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound is an asset that is not live or that the reader may not
	// see (Seen), and an assignment (Form) or signed copy not the asset's.
	ErrNotFound = apperr.New(apperr.NotFound, "asset.not_found", "asset not found")
	// ErrInvalid wraps every validation failure, naming the field.
	ErrInvalid = apperr.New(apperr.Invalid, "asset.invalid", "invalid asset")
	// ErrActorNotFound is an acting user the actor foreign keys do not find.
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "asset.actor_not_found", "acting user not found")
	// ErrEmployeeNotFound is a holder who is not a live employee.
	ErrEmployeeNotFound = apperr.New(apperr.NotFound, "asset.employee_not_found", "employee not found")
	// ErrNoForm is an asset or assignment without a form: one that needs none,
	// or (for a signed copy) an assignment given without one.
	ErrNoForm = apperr.New(apperr.NotFound, "asset.no_form", "this assignment has no form")
	// ErrInventoryNoTaken and ErrSIMNoTaken come wrapped in a DuplicateError
	// naming the asset that has the number.
	ErrInventoryNoTaken = apperr.New(apperr.Conflict, "asset.inventory_no_taken", "inventory number already used")
	ErrSIMNoTaken       = apperr.New(apperr.Conflict, "asset.sim_no_taken", "SIM number already registered")
	// ErrAlreadyGiven refuses giving an asset that has an open assignment.
	ErrAlreadyGiven = apperr.New(apperr.Conflict, "asset.already_given", "asset already given to another employee")
	// ErrBlocked refuses giving a SIM card that is Blocked.
	ErrBlocked = apperr.New(apperr.Conflict, "asset.blocked", "SIM is blocked: have the provider unblock it and set it Active first")
	// ErrNotGiven refuses Return and Mark as Not Returned without an open assignment.
	ErrNotGiven = apperr.New(apperr.Conflict, "asset.not_given", "asset is not given to anyone")
	// ErrAlreadyMarked refuses marking an assignment Not Returned twice.
	ErrAlreadyMarked = apperr.New(apperr.Conflict, "asset.already_marked", "asset is already marked as not returned")
	// ErrFormChanged refuses Give when the form built now differs from the
	// one printed (its hash), so the employee signed another.
	ErrFormChanged = apperr.New(apperr.Conflict, "asset.form_changed", "the form changed after it was printed")
	// ErrNotPermitted refuses Equipment & Furniture to a reader without
	// equipment.read (Sight.Check).
	ErrNotPermitted = apperr.New(apperr.Forbidden, "asset.not_permitted", "Equipment & Furniture needs the Equipment Assignments role")
	// ErrSIMsNotPermitted refuses SIM cards to a reader without sim_cards.read.
	ErrSIMsNotPermitted = apperr.New(apperr.Forbidden, "asset.sims_not_permitted", "SIM cards need the permission See SIM Cards")
	// ErrMayNotChange: SIM cards need Manage SIMs (sim_cards.manage),
	// Equipment & Furniture Manage Equipment & Furniture (assets.manage).
	ErrMayNotChange = apperr.New(apperr.Forbidden, "asset.may_not_change", "your roles do not allow changing this kind of asset")
	// Signed copies (slice 5).
	ErrAssignmentNotFound = apperr.New(apperr.NotFound, "asset.assignment_not_found", "assignment not found")
	ErrNoStorage          = apperr.New(apperr.Unavailable, "asset.no_storage", "file storage is not set up, so signed copies cannot be kept")
	ErrFileType           = apperr.New(apperr.UnsupportedType, "asset.file_type", "a signed copy must be a PDF, JPEG or PNG file")
	ErrFileTooLarge       = apperr.New(apperr.TooLarge, "asset.file_too_large", "a signed copy may be at most 10 MB")
	// PIN and PUK (Scan SIMs).
	ErrNoSIMCodes          = apperr.New(apperr.NotFound, "asset.no_sim_codes", "no PIN and PUK are recorded for this SIM")
	ErrSIMCodesUnavailable = apperr.New(apperr.Unavailable, "asset.sim_codes_unavailable", "PIN and PUK cannot be kept or shown: the API has no API_SIM_CODES_KEY")
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
