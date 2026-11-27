package session

import (
	"fmt"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound: no such session, or not the user's, or no longer live
	// where a live one is needed.
	ErrNotFound = apperr.New(apperr.NotFound, "session.not_found", "session not found")
	// ErrInvalid: a request the service refuses (no user, an unknown reason);
	// fieldError wraps it with the field and the problem.
	ErrInvalid = apperr.New(apperr.Invalid, "session.invalid", "invalid session")
	// ErrInvalidToken refuses a refresh token: malformed, unknown, expired,
	// ended or reused. It never says which.
	ErrInvalidToken = apperr.New(apperr.Unauthenticated, "session.invalid_token", "invalid refresh token")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
