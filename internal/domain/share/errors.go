package share

import (
	"fmt"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound: no such link, or not the reader's (Revoke), or no longer
	// open (Revoke of a revoked or expired link).
	ErrNotFound = apperr.New(apperr.NotFound, "share.not_found", "shared link not found")
	// ErrGone: the link was revoked or has expired (Open).
	ErrGone = apperr.New(apperr.Gone, "share.gone", "shared link is no longer available")
	// ErrInvalid: the request breaks a rule; fieldError wraps it.
	ErrInvalid = apperr.New(apperr.Invalid, "share.invalid", "invalid shared link")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "share.actor_not_found", "acting user not found")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
