// Package apperr gives the domains' sentinel errors a kind and a stable code.
//
// A domain declares each sentinel with New, keeping its own package variable
// (callers still match it with errors.Is), and the kind says what sort of
// refusal it is, so the HTTP layer maps kinds to statuses instead of listing
// every sentinel. The code ("supplier.code_taken") is a stable name for the
// error that the API answers beside the message. The package knows no HTTP and
// imports no domain.
package apperr

import "errors"

// The kinds. Each is a sentinel a kinded error matches with errors.Is.
var (
	// BadRequest is a request the API cannot read (malformed JSON, a bad UUID).
	BadRequest = errors.New("bad request")
	// Invalid is a request the API reads but refuses: a field's value, or a
	// record the request names that does not exist where it must.
	Invalid = errors.New("invalid")
	// Unauthenticated is a caller the API does not know: bad credentials or
	// token, or an actor the database no longer has.
	Unauthenticated = errors.New("unauthenticated")
	// Forbidden is a caller who may not do this.
	Forbidden = errors.New("forbidden")
	// NotFound is a record that is not there or that the reader may not see.
	NotFound = errors.New("not found")
	// Conflict is a request the current state refuses (a taken name, a
	// status that does not allow it, a setting not made yet).
	Conflict = errors.New("conflict")
	// Gone is something that was there and is no longer (an expired link).
	Gone = errors.New("gone")
	// TooLarge is a body or file over its limit.
	TooLarge = errors.New("too large")
	// UnsupportedType is a file of a type the API does not take.
	UnsupportedType = errors.New("unsupported type")
	// Unprocessable is content read but not made into what was asked.
	Unprocessable = errors.New("unprocessable")
	// TooMany is a limit on attempts or spending reached.
	TooMany = errors.New("too many")
	// Unavailable is a feature the server is not set up for (a missing key
	// or storage).
	Unavailable = errors.New("unavailable")
)

// Error is a sentinel with a kind and a code. Its message is the domain's own.
type Error struct {
	kind error
	code string
	msg  string
}

// New is a sentinel of kind with a stable code and the message the API
// answers. kind is one of this package's kinds. It returns error, so a
// package variable keeps the type error; errors.As reaches the *Error.
func New(kind error, code, msg string) error {
	return &Error{kind: kind, code: code, msg: msg}
}

// Error is the message.
func (e *Error) Error() string { return e.msg }

// Is reports the error's kind, so errors.Is(err, apperr.NotFound) holds for
// every not-found sentinel. The sentinel itself still matches by identity.
func (e *Error) Is(target error) bool { return target == e.kind }

// Kind is one of the package's kinds.
func (e *Error) Kind() error { return e.kind }

// Code is the stable name, such as "supplier.not_found".
func (e *Error) Code() string { return e.code }

// CodeOf is the code of the first coded error in err's chain (an *Error, or
// a module's error with a Code method, such as App Launcher's), or "".
func CodeOf(err error) string {
	var e interface{ Code() string }
	if errors.As(err, &e) {
		return e.Code()
	}
	return ""
}
