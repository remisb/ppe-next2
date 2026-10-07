package user

import (
	"errors"
	"fmt"

	"github.com/google/uuid"
)

var (
	ErrNotFound           = errors.New("user not found")
	ErrInvalid            = errors.New("invalid user")
	ErrEmailTaken         = errors.New("email already in use")
	ErrInvalidCredentials = errors.New("invalid email or password")
	// ErrActorNotFound means the acting user ID does not name a user. The actor
	// comes from a verified token, so the transport maps this to 401.
	ErrActorNotFound = errors.New("acting user not found")
	// ErrNotPermitted: the actor tried to give or take away, or to manage a
	// user with, permissions the actor does not hold.
	ErrNotPermitted = errors.New("you cannot manage permissions you do not have")
	// ErrLastAdministrator: the change would leave no active user holding
	// the Administrator role, and so no one able to manage users and roles.
	ErrLastAdministrator = errors.New("at least one active user must keep the Administrator role")
)

// Why Authenticate refused a sign-in, for the security log; the response
// never says (every refusal is ErrInvalidCredentials).
const (
	RefusedUnknownEmail = "unknown_email"
	RefusedBadPassword  = "bad_password"
	RefusedInactive     = "inactive"
)

// SignInRefused is the ErrInvalidCredentials Authenticate returns, with what
// the security log records about it.
type SignInRefused struct {
	Reason string
	// UserID is the account the email names; uuid.Nil for none.
	UserID uuid.UUID
}

func (e *SignInRefused) Error() string { return ErrInvalidCredentials.Error() }
func (e *SignInRefused) Unwrap() error { return ErrInvalidCredentials }

// fieldError builds a validation error that wraps ErrInvalid and names the input.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
