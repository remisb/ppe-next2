package supplier

import (
	"fmt"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound: no live supplier with that id (a deleted one is not there).
	ErrNotFound = apperr.New(apperr.NotFound, "supplier.not_found", "supplier not found")
	// ErrInvalid: the request breaks a rule the service or a database CHECK
	// enforces; fieldError wraps it with the field and the problem.
	ErrInvalid = apperr.New(apperr.Invalid, "supplier.invalid", "invalid supplier")
	// ErrCodeTaken: another live supplier has the code, compared
	// case-insensitively.
	ErrCodeTaken = apperr.New(apperr.Conflict, "supplier.code_taken", "supplier code already in use")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "supplier.actor_not_found", "acting user not found")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
