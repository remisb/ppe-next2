package document

import (
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/personnel/mrz"
)

var (
	// ErrNotFound is no live document (or copy, or personnel file) by that id (404).
	ErrNotFound = errors.New("identity document not found")
	// ErrInvalid is a field that breaks a rule (400); fieldError names it, and
	// ProblemsError wraps it for an MRZ the parser refuses.
	ErrInvalid = errors.New("invalid identity document")
	// ErrActorNotFound is an acting user who no longer exists (401).
	ErrActorNotFound = errors.New("acting user not found")
	// ErrEmployeeNotFound is a document for an employee who is not there (or deleted).
	ErrEmployeeNotFound = errors.New("employee not found")
	// ErrEmployeeCodeTaken is a new employee with a code another live employee has.
	ErrEmployeeCodeTaken = errors.New("employee code already in use")
	// ErrNotConfigured is Personnel files without its keys (API_PERSONNEL_KEY,
	// API_PERSONNEL_INDEX_KEY) or without a files store: nothing is sealed or kept.
	ErrNotConfigured = errors.New("personnel files are not configured")
	// ErrCopyTooLarge is a copy over 5 MB.
	ErrCopyTooLarge = errors.New("a document copy is too large")
	// ErrCopyNotJPEG is a copy that is not a JPEG of at most 2400 px.
	ErrCopyNotJPEG = errors.New("a document copy must be a JPEG of at most 2400 px")
	// ErrUnopenable is a sealed value that does not open: another key, a
	// changed byte. Never names the value.
	ErrUnopenable = errors.New("a sealed document does not open")
)

// fieldError is ErrInvalid, naming the field and what is wrong with it.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}

// ProblemsError is an MRZ the API's parser refuses: the problems as codes and
// fields, never what was read.
type ProblemsError struct {
	Problems []mrz.Issue
}

// Error lists the problems' codes, each with its field.
func (e *ProblemsError) Error() string {
	codes := make([]string, len(e.Problems))
	for i, p := range e.Problems {
		codes[i] = p.Code
		if p.Field != "" {
			codes[i] += " (" + p.Field + ")"
		}
	}
	return "the document's MRZ has problems: " + strings.Join(codes, ", ")
}

// Unwrap makes every ProblemsError an ErrInvalid (400).
func (e *ProblemsError) Unwrap() error { return ErrInvalid }

// DuplicateError is a document already on file (the same number and issuing
// state, live), or a personal code that is another employee's. It names the
// employee and document it found, never the number or code.
type DuplicateError struct {
	// What is "document_on_file" or "other_employee".
	What       string
	EmployeeID uuid.UUID
	DocumentID uuid.UUID // uuid.Nil for other_employee by personal code
}

// The two kinds of DuplicateError, as the API's error body's conflict.
const (
	duplicateDocument      = "document_on_file"
	duplicateOtherEmployee = "other_employee"
)

// Error says which duplicate it is, naming nothing read from the document.
func (e *DuplicateError) Error() string {
	if e.What == duplicateDocument {
		return "this document is already on file"
	}
	return "this personal code is another employee's"
}

// ErrDuplicate is what every DuplicateError is (409).
var ErrDuplicate = errors.New("identity document conflict")

// Unwrap makes every DuplicateError an ErrDuplicate.
func (e *DuplicateError) Unwrap() error { return ErrDuplicate }

// ExistingID is the document already on file, else the other employee: what
// the app opens (the API's error body's existing_id).
func (e *DuplicateError) ExistingID() uuid.UUID {
	if e.DocumentID != uuid.Nil {
		return e.DocumentID
	}
	return e.EmployeeID
}

// Conflict says which duplicate it is: document_on_file or other_employee.
func (e *DuplicateError) Conflict() string { return e.What }

// MRZProblems are the problems, for the API's error body.
func (e *ProblemsError) MRZProblems() []mrz.Issue { return e.Problems }
