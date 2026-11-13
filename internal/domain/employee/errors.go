package employee

import (
	"errors"
	"fmt"
)

var (
	// ErrNotFound is an employee that is not live (missing, deleted or merged
	// away; see MergedError).
	ErrNotFound = errors.New("employee not found")
	// ErrInvalid wraps every validation failure, naming the field.
	ErrInvalid = errors.New("invalid employee")
	// ErrCodeTaken is a code another live employee has (see CodeTakenError).
	ErrCodeTaken = errors.New("employee code already in use")
	// ErrActorNotFound is an acting user the actor foreign keys do not find.
	ErrActorNotFound = errors.New("acting user not found")
	// ErrHoldsAssets refuses deleting an employee who holds company assets;
	// the message names them.
	ErrHoldsAssets = errors.New("employee holds company assets")
	// ErrNotPermitted refuses adding or editing an employee without Manage
	// employee profiles (employee_profiles.manage).
	ErrNotPermitted = errors.New("adding and editing employees needs Manage employee profiles")
)

// fieldError is ErrInvalid for field, saying its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
