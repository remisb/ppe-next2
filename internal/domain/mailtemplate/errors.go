package mailtemplate

import (
	"errors"
	"fmt"
)

var (
	// ErrNotFound: no use case has that key.
	ErrNotFound = errors.New("mail template not found")
	// ErrInvalid: the text breaks a rule TextParams.Validate checks;
	// fieldError wraps it with the part and the problem.
	ErrInvalid = errors.New("invalid mail template")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = errors.New("acting user not found")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
