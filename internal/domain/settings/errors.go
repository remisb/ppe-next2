package settings

import (
	"errors"
	"fmt"
)

var (
	ErrInvalid       = errors.New("invalid settings")
	ErrActorNotFound = errors.New("acting user not found")
)

func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
