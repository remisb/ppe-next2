package itemset

import (
	"errors"
	"fmt"
)

var (
	// ErrNotFound: no live set with that id (a deleted one is not there).
	ErrNotFound = errors.New("item set not found")
	// ErrInvalid: the request breaks a rule the service or a database CHECK
	// enforces; fieldError wraps it with the field and the problem.
	ErrInvalid = errors.New("invalid item set")
	// ErrNameTaken: another live set has the name, compared case-insensitively.
	ErrNameTaken = errors.New("item set name already in use")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = errors.New("acting user not found")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}

// ErrUnknownItem: a line references a catalogue item that does not exist or
// was deleted.
var ErrUnknownItem = errors.New("item set references an unknown catalogue item")
