package supplier

import (
	"errors"
	"fmt"
)

var (
	// ErrNotFound: no live supplier with that id (a deleted one is not there).
	ErrNotFound = errors.New("supplier not found")
	// ErrInvalid: the request breaks a rule the service or a database CHECK
	// enforces; fieldError wraps it with the field and the problem.
	ErrInvalid = errors.New("invalid supplier")
	// ErrCodeTaken: another live supplier has the code, compared
	// case-insensitively.
	ErrCodeTaken = errors.New("supplier code already in use")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = errors.New("acting user not found")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
