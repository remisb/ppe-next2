package document

import (
	"context"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// EmployeeRecord is the part of the employee (People) a document reads and
// may write: the names, and the fields Add to Employee Record fills.
type EmployeeRecord struct {
	ID          uuid.UUID
	FirstName   string
	LastName    string
	Code        *string
	BirthDate   *string // ISO
	Nationality *string
	Sex         *string
}

// Subject is the person's row in Personnel files, with their sealed data key.
type Subject struct {
	EmployeeID    uuid.UUID
	PersonalIndex []byte // nil when no personal code is on file
	SealedKey     []byte
	KeyID         int16
}

// Copy is a Document Copy's row; its object is sealed in the files store.
type Copy struct {
	ID        uuid.UUID
	Side      Side
	ObjectKey string
	SHA256    []byte
	Bytes     int
}

// SaveRecord is one Save, written in one transaction.
type SaveRecord struct {
	// NewEmployee is set when the document creates the employee; else
	// EmployeeID names one, locked FOR UPDATE.
	NewEmployee *EmployeeRecord
	EmployeeID  uuid.UUID
	// NewSubject is set the first time the person has a document; else the
	// subject is locked, and PersonalIndex is written if it had none.
	NewSubject    *Subject
	PersonalIndex []byte
	Document      Document
	Sealed        []byte
	NumberIndex   []byte
	Copies        []Copy
	// Mutate decides, under the locks, what the employee becomes and which
	// events record it all, given the employee as it is and the person's live
	// documents of the same kind, which this one supersedes.
	Mutate func(cur EmployeeRecord, superseded []Document) (EmployeeRecord, []audit.Event, error)
}

// Ref names a document and its employee, never its number.
type Ref struct {
	EmployeeID uuid.UUID `json:"employee_id"`
	DocumentID uuid.UUID `json:"document_id"`
}

// Repository keeps identity documents. It translates storage errors to this
// package's: a duplicate number to a DuplicateError (document_on_file), a
// personal code on another subject to one (other_employee).
type Repository interface {
	// DocumentByNumber is the live document with this number index and state.
	DocumentByNumber(ctx context.Context, numberIndex []byte, issuingState string) (Ref, bool, error)
	// SubjectByPersonalCode is the employee whose personal code has this index.
	SubjectByPersonalCode(ctx context.Context, personalIndex []byte) (uuid.UUID, bool, error)
	// Subject is the employee's subject, if they have one.
	Subject(ctx context.Context, employeeID uuid.UUID) (Subject, bool, error)
	// PossibleDuplicates are live employees with these names, or this last
	// name and birth date, for a new employee (at most a few).
	PossibleDuplicates(ctx context.Context, firstName, lastName string, birthDate *string) ([]uuid.UUID, error)
	Save(ctx context.Context, rec SaveRecord) error
	// Documents are the employee's live documents, current ones first, then newest first,
	// superseded ones included.
	Documents(ctx context.Context, employeeID uuid.UUID) ([]Document, error)
}
