package settings

import (
	"fmt"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrInvalid: the request breaks a rule the service checks; fieldError
	// wraps it with the field and the problem.
	ErrInvalid = apperr.New(apperr.Invalid, "settings.invalid", "invalid settings")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "settings.actor_not_found", "acting user not found")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
