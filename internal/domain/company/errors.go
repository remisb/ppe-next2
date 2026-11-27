package company

import (
	"fmt"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound: no live company with that id (a deleted one is not there),
	// or, from Default, no default company.
	ErrNotFound = apperr.New(apperr.NotFound, "company.not_found", "company not found")
	// ErrInvalid: the request breaks a rule the service or a database CHECK
	// enforces; fieldError wraps it with the field and the problem.
	ErrInvalid = apperr.New(apperr.Invalid, "company.invalid", "invalid company")
	// ErrCodeTaken: another live company has the internal code, compared
	// case-insensitively.
	ErrCodeTaken = apperr.New(apperr.Conflict, "company.code_taken", "company code already in use")
	// ErrIsDefault: the default company cannot be deleted; make another the
	// default first.
	ErrIsDefault = apperr.New(apperr.Conflict, "company.is_default", "the default company cannot be deleted")
	// ErrInUse: the company employs someone now (an open employment); end or
	// move their employment first.
	ErrInUse = apperr.New(apperr.Conflict, "company.in_use", "company employs people")
	// ErrDefaultTaken: a company stored as the default while another live
	// company is it; Create then adds it as not the default.
	ErrDefaultTaken = apperr.New(apperr.Conflict, "company.default_taken", "another company is the default")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "company.actor_not_found", "acting user not found")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
