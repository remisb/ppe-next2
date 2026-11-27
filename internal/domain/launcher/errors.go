package launcher

import (
	"fmt"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound: no tile has the slug, or not one the user sees (feedback, a
	// channel choice), or an address under /apps/ opens nothing (404).
	ErrNotFound = apperr.New(apperr.NotFound, "launcher.not_found", "app not found")
	// ErrInvalid: a field breaks a rule (400); fieldError names it.
	ErrInvalid = apperr.New(apperr.Invalid, "launcher.invalid", "invalid app")
	// ErrSlugTaken: another tile has the slug (409).
	ErrSlugTaken = apperr.New(apperr.Conflict, "launcher.slug_taken", "app slug already in use")
	// ErrActorNotFound: the acting or choosing user no longer exists (401).
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "launcher.actor_not_found", "acting user not found")
)

// fieldError is ErrInvalid, naming the field and what is wrong with it.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
