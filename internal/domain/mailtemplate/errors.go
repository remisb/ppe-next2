package mailtemplate

import (
	"fmt"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound: no use case has that key.
	ErrNotFound = apperr.New(apperr.NotFound, "mail_template.not_found", "mail template not found")
	// ErrInvalid: the text breaks a rule TextParams.Validate checks;
	// fieldError wraps it with the part and the problem.
	ErrInvalid = apperr.New(apperr.Invalid, "mail_template.invalid", "invalid mail template")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "mail_template.actor_not_found", "acting user not found")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
