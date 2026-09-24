package employee

import (
	"errors"
	"fmt"
)

var (
	ErrNotFound      = errors.New("employee not found")
	ErrInvalid       = errors.New("invalid employee")
	ErrCodeTaken     = errors.New("employee code already in use")
	ErrActorNotFound = errors.New("acting user not found")
)

func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
