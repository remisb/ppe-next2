package share

import (
	"errors"
	"fmt"
)

var (
	// ErrNotFound: no such link, or not the reader's (Revoke), or no longer
	// open (Revoke of a revoked or expired link).
	ErrNotFound = errors.New("shared link not found")
	// ErrGone: the link was revoked or has expired (Open).
	ErrGone = errors.New("shared link is no longer available")
	// ErrInvalid: the request breaks a rule; fieldError wraps it.
	ErrInvalid = errors.New("invalid shared link")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = errors.New("acting user not found")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
