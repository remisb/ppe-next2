package role

import (
	"errors"
	"fmt"
)

var (
	// ErrNotFound: no live role with that id.
	ErrNotFound = errors.New("role not found")
	// ErrInvalid: the request breaks a rule the service checks (an unknown
	// permission, a missing requirement, a built-in's new name, deleting a
	// built-in); fieldError wraps it with the field and the problem.
	ErrInvalid = errors.New("invalid role")
	// ErrNameTaken: another live role has the name, compared case-insensitively.
	ErrNameTaken = errors.New("role name already in use")
	// ErrInUse: a live user holds the role, so it is not deleted.
	ErrInUse = errors.New("role is held by users")
	// ErrBuiltIn: Administrator, which is never changed or deleted.
	ErrBuiltIn = errors.New("the built-in Administrator role cannot be changed or deleted")
	// ErrNotPermitted: the actor tried to grant a permission they do not hold.
	ErrNotPermitted = errors.New("you cannot grant permissions you do not have")
	// ErrActorNotFound means the acting user ID does not name a user (401).
	ErrActorNotFound = errors.New("acting user not found")
)

// fieldError builds a validation error that wraps ErrInvalid and names the input.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
