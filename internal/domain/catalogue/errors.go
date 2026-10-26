package catalogue

import (
	"errors"
	"fmt"
)

var (
	ErrNotFound = errors.New("catalogue item not found")
	// ErrPictureNotFound is an icon that names no picture.
	ErrPictureNotFound = errors.New("catalogue picture not found")
	ErrInvalid         = errors.New("invalid catalogue item")
	ErrNameTaken       = errors.New("catalogue item name already in use")
	ErrActorNotFound   = errors.New("acting user not found")
	// ErrNotPermitted is a price set or changed by someone whose Rights do
	// not include prices.
	ErrNotPermitted = errors.New("not permitted to change item prices")
)

func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
