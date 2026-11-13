package launcher

import (
	"errors"
	"fmt"
)

var (
	// ErrNotFound: no tile has the slug, or not one the user sees (feedback, a
	// channel choice), or an address under /apps/ opens nothing (404).
	ErrNotFound = errors.New("app not found")
	// ErrInvalid: a field breaks a rule (400); fieldError names it.
	ErrInvalid = errors.New("invalid app")
	// ErrSlugTaken: another tile has the slug (409).
	ErrSlugTaken = errors.New("app slug already in use")
	// ErrActorNotFound: the acting or choosing user no longer exists (401).
	ErrActorNotFound = errors.New("acting user not found")
)

// fieldError is ErrInvalid, naming the field and what is wrong with it.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
