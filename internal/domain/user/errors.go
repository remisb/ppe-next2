package user

import (
	"errors"
	"fmt"

	"github.com/google/uuid"
)

var (
	// ErrNotFound: no live user with that id or email.
	ErrNotFound = errors.New("user not found")
	// ErrInvalid: the request breaks a rule the service checks; fieldError
	// wraps it with the field and the problem.
	ErrInvalid = errors.New("invalid user")
	// ErrEmailTaken: another live user has the email, compared case-insensitively.
	ErrEmailTaken = errors.New("email already in use")
	// ErrInvalidCredentials: a sign-in refused, whatever the reason
	// (SignInRefused says which, for the security log alone).
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
	// RefusedUnknownEmail: no live user has the email.
	RefusedUnknownEmail = "unknown_email"
	// RefusedBadPassword: the password is wrong (checked before activity).
	RefusedBadPassword = "bad_password"
	// RefusedInactive: the right password for a deactivated account.
	RefusedInactive = "inactive"
)

// SignInRefused is the ErrInvalidCredentials Authenticate returns, with what
// the security log records about it.
type SignInRefused struct {
	Reason string
	// UserID is the account the email names; uuid.Nil for none.
	UserID uuid.UUID
}

// Error is ErrInvalidCredentials' message: the reason is never shown.
func (e *SignInRefused) Error() string { return ErrInvalidCredentials.Error() }

// Unwrap makes a SignInRefused ErrInvalidCredentials to errors.Is.
func (e *SignInRefused) Unwrap() error { return ErrInvalidCredentials }

// fieldError builds a validation error that wraps ErrInvalid and names the input.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
