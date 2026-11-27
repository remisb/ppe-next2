package employee

import (
	"fmt"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound is an employee that is not live (missing, deleted or merged
	// away; see MergedError).
	ErrNotFound = apperr.New(apperr.NotFound, "employee.not_found", "employee not found")
	// ErrInvalid wraps every validation failure, naming the field.
	ErrInvalid = apperr.New(apperr.Invalid, "employee.invalid", "invalid employee")
	// ErrCodeTaken is a code another live employee has (see CodeTakenError).
	ErrCodeTaken = apperr.New(apperr.Conflict, "employee.code_taken", "employee code already in use")
	// ErrActorNotFound is an acting user the actor foreign keys do not find.
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "employee.actor_not_found", "acting user not found")
	// ErrHoldsAssets refuses deleting an employee who holds company assets;
	// the message names them.
	ErrHoldsAssets = apperr.New(apperr.Conflict, "employee.holds_assets", "employee holds company assets")
	// ErrEmploymentNotFound is no live employment of that id on the employee.
	ErrEmploymentNotFound = apperr.New(apperr.NotFound, "employee.employment_not_found", "employment not found")
	// ErrCompanyNotFound is a company that is not live (missing or deleted).
	ErrCompanyNotFound = apperr.New(apperr.Invalid, "employee.company_not_found", "company not found")
	// ErrEmployed refuses a second open employment: end the current one, or
	// move to another company.
	ErrEmployed = apperr.New(apperr.Conflict, "employee.employed", "employee is employed already")
	// ErrEnded refuses ending an employment that has ended.
	ErrEnded = apperr.New(apperr.Conflict, "employee.ended", "employment has ended already")
	// ErrOverlap refuses a period that shares days with another of the
	// employee's.
	ErrOverlap = apperr.New(apperr.Conflict, "employee.overlap", "employment overlaps another")
	// ErrBothEmployed refuses merging two records that are both employed
	// now: end one employment first.
	ErrBothEmployed = apperr.New(apperr.Conflict, "employee.both_employed", "both employees are employed now")
	// ErrNotPermitted refuses adding or editing an employee without Manage
	// employee profiles (employee_profiles.manage).
	ErrNotPermitted = apperr.New(apperr.Forbidden, "employee.not_permitted", "adding and editing employees needs Manage employee profiles")
)

// fieldError is ErrInvalid for field, saying its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
