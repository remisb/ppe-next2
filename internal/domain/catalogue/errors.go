package catalogue

import (
	"errors"
	"fmt"
)

var (
	ErrNotFound      = errors.New("catalogue item not found")
	ErrInvalid       = errors.New("invalid catalogue item")
	ErrNameTaken     = errors.New("catalogue item name already in use")
	ErrActorNotFound = errors.New("acting user not found")
)

func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
