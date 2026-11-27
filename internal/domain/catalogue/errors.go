package catalogue

import (
	"fmt"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound: no live item with that id (a deleted one is not there).
	ErrNotFound = apperr.New(apperr.NotFound, "catalogue.not_found", "catalogue item not found")
	// ErrPictureNotFound is an icon that names no picture.
	ErrPictureNotFound = apperr.New(apperr.NotFound, "catalogue.picture_not_found", "catalogue picture not found")
	// ErrInvalid: the request breaks a rule the service or a database CHECK
	// enforces; fieldError wraps it with the field and the problem.
	ErrInvalid = apperr.New(apperr.Invalid, "catalogue.invalid", "invalid catalogue item")
	// ErrNameTaken: another live item has the name, compared case-insensitively.
	ErrNameTaken = apperr.New(apperr.Conflict, "catalogue.name_taken", "catalogue item name already in use")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "catalogue.actor_not_found", "acting user not found")
	// ErrNotPermitted is a price set or changed by someone whose Rights do
	// not include prices.
	ErrNotPermitted = apperr.New(apperr.Forbidden, "catalogue.not_permitted", "not permitted to change item prices")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
