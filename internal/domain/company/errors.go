package company

import (
	"errors"
	"fmt"
)

var (
	// ErrNotFound: no live company with that id (a deleted one is not there),
	// or, from Default, no default company.
	ErrNotFound = errors.New("company not found")
	// ErrInvalid: the request breaks a rule the service or a database CHECK
	// enforces; fieldError wraps it with the field and the problem.
	ErrInvalid = errors.New("invalid company")
	// ErrCodeTaken: another live company has the internal code, compared
	// case-insensitively.
	ErrCodeTaken = errors.New("company code already in use")
	// ErrIsDefault: the default company cannot be deleted; make another the
	// default first.
	ErrIsDefault = errors.New("the default company cannot be deleted")
	// ErrInUse: the company employs someone now (an open employment); end or
	// move their employment first.
	ErrInUse = errors.New("company employs people")
	// ErrDefaultTaken: a company stored as the default while another live
	// company is it; Create then adds it as not the default.
	ErrDefaultTaken = errors.New("another company is the default")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = errors.New("acting user not found")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
