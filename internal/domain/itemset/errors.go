package itemset

import (
	"errors"
	"fmt"
)

var (
	ErrNotFound      = errors.New("item set not found")
	ErrInvalid       = errors.New("invalid item set")
	ErrNameTaken     = errors.New("item set name already in use")
	ErrActorNotFound = errors.New("acting user not found")
)

func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}

// ErrUnknownItem: a line references a catalogue item that does not exist or
// was deleted.
var ErrUnknownItem = errors.New("item set references an unknown catalogue item")
