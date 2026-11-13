package settings

import (
	"errors"
	"fmt"
)

var (
	// ErrInvalid: the request breaks a rule the service checks; fieldError
	// wraps it with the field and the problem.
	ErrInvalid = errors.New("invalid settings")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = errors.New("acting user not found")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
