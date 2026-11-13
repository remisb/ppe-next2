package catalogue

import (
	"errors"
	"fmt"
)

var (
	// ErrNotFound: no live item with that id (a deleted one is not there).
	ErrNotFound = errors.New("catalogue item not found")
	// ErrPictureNotFound is an icon that names no picture.
	ErrPictureNotFound = errors.New("catalogue picture not found")
	// ErrInvalid: the request breaks a rule the service or a database CHECK
	// enforces; fieldError wraps it with the field and the problem.
	ErrInvalid = errors.New("invalid catalogue item")
	// ErrNameTaken: another live item has the name, compared case-insensitively.
	ErrNameTaken = errors.New("catalogue item name already in use")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = errors.New("acting user not found")
	// ErrNotPermitted is a price set or changed by someone whose Rights do
	// not include prices.
	ErrNotPermitted = errors.New("not permitted to change item prices")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
