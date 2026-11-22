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
	// ErrEmploymentNotFound is no live employment of that id on the employee.
	ErrEmploymentNotFound = errors.New("employment not found")
	// ErrCompanyNotFound is a company that is not live (missing or deleted).
	ErrCompanyNotFound = errors.New("company not found")
	// ErrEmployed refuses a second open employment: end the current one, or
	// move to another company.
	ErrEmployed = errors.New("employee is employed already")
	// ErrEnded refuses ending an employment that has ended.
	ErrEnded = errors.New("employment has ended already")
	// ErrOverlap refuses a period that shares days with another of the
	// employee's.
	ErrOverlap = errors.New("employment overlaps another")
	// ErrBothEmployed refuses merging two records that are both employed
	// now: end one employment first.
	ErrBothEmployed = errors.New("both employees are employed now")
	// ErrNotPermitted refuses adding or editing an employee without Manage
	// employee profiles (employee_profiles.manage).
	ErrNotPermitted = errors.New("adding and editing employees needs Manage employee profiles")
)

// fieldError is ErrInvalid for field, saying its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
