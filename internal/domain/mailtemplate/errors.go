package mailtemplate

import (
	"errors"
	"fmt"
)

var (
	// ErrNotFound: no use case has that key.
	ErrNotFound      = errors.New("mail template not found")
	ErrInvalid       = errors.New("invalid mail template")
	ErrActorNotFound = errors.New("acting user not found")
)

func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
