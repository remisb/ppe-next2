package asset

import (
	"errors"
	"fmt"

	"github.com/google/uuid"
)

var (
	ErrNotFound         = errors.New("asset not found")
	ErrInvalid          = errors.New("invalid asset")
	ErrActorNotFound    = errors.New("acting user not found")
	ErrEmployeeNotFound = errors.New("employee not found")
	ErrNoForm           = errors.New("this assignment has no form")
	// ErrInventoryNoTaken and ErrSIMNoTaken come wrapped in a DuplicateError
	// naming the asset that has the number.
	ErrInventoryNoTaken = errors.New("inventory number already used")
	ErrSIMNoTaken       = errors.New("SIM number already registered")
	ErrAlreadyGiven     = errors.New("asset already given to another employee")
	ErrNotActive        = errors.New("SIM card is not active")
	ErrNotGiven         = errors.New("asset is not given to anyone")
	ErrAlreadyMarked    = errors.New("asset is already marked as not returned")
	ErrFormChanged      = errors.New("the form changed after it was printed")
)

func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}

// DuplicateError is a number conflict with the asset that already has the
// number, so the app can open it (assets brief §4).
type DuplicateError struct {
	Err      error // ErrInventoryNoTaken or ErrSIMNoTaken
	Existing uuid.UUID
}

func (e *DuplicateError) Error() string         { return e.Err.Error() }
func (e *DuplicateError) Unwrap() error         { return e.Err }
func (e *DuplicateError) ExistingID() uuid.UUID { return e.Existing }
