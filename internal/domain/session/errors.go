package session

import (
	"errors"
	"fmt"
)

var (
	ErrNotFound = errors.New("session not found")
	ErrInvalid  = errors.New("invalid session")
	// ErrInvalidToken refuses a refresh token: malformed, unknown, expired,
	// ended or reused. It never says which.
	ErrInvalidToken = errors.New("invalid refresh token")
)

func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
