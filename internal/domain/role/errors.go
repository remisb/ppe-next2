package role

import (
	"errors"
	"fmt"
)

var (
	ErrNotFound  = errors.New("role not found")
	ErrInvalid   = errors.New("invalid role")
	ErrNameTaken = errors.New("role name already in use")
	ErrInUse     = errors.New("role is held by users")
	ErrBuiltIn   = errors.New("the built-in Administrator role cannot be changed or deleted")
	// ErrNotPermitted: the actor tried to grant a permission they do not hold.
	ErrNotPermitted = errors.New("you cannot grant permissions you do not have")
	// ErrActorNotFound means the acting user ID does not name a user (401).
	ErrActorNotFound = errors.New("acting user not found")
)

// fieldError builds a validation error that wraps ErrInvalid and names the input.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
