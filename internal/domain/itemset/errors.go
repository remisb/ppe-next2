package itemset

import (
	"fmt"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound: no live set with that id (a deleted one is not there).
	ErrNotFound = apperr.New(apperr.NotFound, "item_set.not_found", "item set not found")
	// ErrInvalid: the request breaks a rule the service or a database CHECK
	// enforces; fieldError wraps it with the field and the problem.
	ErrInvalid = apperr.New(apperr.Invalid, "item_set.invalid", "invalid item set")
	// ErrNameTaken: another live set has the name, compared case-insensitively.
	ErrNameTaken = apperr.New(apperr.Conflict, "item_set.name_taken", "item set name already in use")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "item_set.actor_not_found", "acting user not found")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}

// ErrUnknownItem: a line references a catalogue item that does not exist or
// was deleted.
var ErrUnknownItem = apperr.New(apperr.Invalid, "item_set.unknown_item", "item set references an unknown catalogue item")
