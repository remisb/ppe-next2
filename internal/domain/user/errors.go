package user

import (
	"fmt"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound: no live user with that id or email.
	ErrNotFound = apperr.New(apperr.NotFound, "user.not_found", "user not found")
	// ErrInvalid: the request breaks a rule the service checks; fieldError
	// wraps it with the field and the problem.
	ErrInvalid = apperr.New(apperr.Invalid, "user.invalid", "invalid user")
	// ErrEmailTaken: another live user has the email, compared case-insensitively.
	ErrEmailTaken = apperr.New(apperr.Conflict, "user.email_taken", "email already in use")
	// ErrInvalidCredentials: a sign-in refused, whatever the reason
	// (SignInRefused says which, for the security log alone).
	ErrInvalidCredentials = apperr.New(apperr.Unauthenticated, "user.invalid_credentials", "invalid email or password")
	// ErrActorNotFound means the acting user ID does not name a user. The actor
	// comes from a verified token, so the transport maps this to 401.
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "user.actor_not_found", "acting user not found")
	// ErrNotPermitted: the actor tried to give or take away, or to manage a
	// user with, permissions the actor does not hold.
	ErrNotPermitted = apperr.New(apperr.Forbidden, "user.not_permitted", "you cannot manage permissions you do not have")
	// ErrLastAdministrator: the change would leave no active user holding
	// the Administrator role, and so no one able to manage users and roles.
	ErrLastAdministrator = apperr.New(apperr.Conflict, "user.last_administrator", "at least one active user must keep the Administrator role")
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
