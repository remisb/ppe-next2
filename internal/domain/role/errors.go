package role

import (
	"fmt"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound: no live role with that id.
	ErrNotFound = apperr.New(apperr.NotFound, "role.not_found", "role not found")
	// ErrInvalid: the request breaks a rule the service checks (an unknown
	// permission, a missing requirement, a built-in's new name, deleting a
	// built-in); fieldError wraps it with the field and the problem.
	ErrInvalid = apperr.New(apperr.Invalid, "role.invalid", "invalid role")
	// ErrNameTaken: another live role has the name, compared case-insensitively.
	ErrNameTaken = apperr.New(apperr.Conflict, "role.name_taken", "role name already in use")
	// ErrInUse: a live user holds the role, so it is not deleted.
	ErrInUse = apperr.New(apperr.Conflict, "role.in_use", "role is held by users")
	// ErrBuiltIn: Administrator, which is never changed or deleted.
	ErrBuiltIn = apperr.New(apperr.Conflict, "role.built_in", "the built-in Administrator role cannot be changed or deleted")
	// ErrNotPermitted: the actor tried to grant a permission they do not hold.
	ErrNotPermitted = apperr.New(apperr.Forbidden, "role.not_permitted", "you cannot grant permissions you do not have")
	// ErrActorNotFound means the acting user ID does not name a user (401).
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "role.actor_not_found", "acting user not found")
)

// fieldError builds a validation error that wraps ErrInvalid and names the input.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
