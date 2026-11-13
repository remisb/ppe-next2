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
	// Save writes rec in one transaction (see SaveRecord); ErrEmployeeNotFound
	// when the employee is gone.
	Save(ctx context.Context, rec SaveRecord) error
	// Documents are the employee's live documents, current ones first, then newest first,
	// superseded ones included.
	Documents(ctx context.Context, employeeID uuid.UUID) ([]Document, error)

	// Document is a live document with its sealed fields and copies, and its
	// subject's data key; ErrNotFound when there is none.
	Document(ctx context.Context, id uuid.UUID) (Opened, error)
	// Record writes events alone (Show Document's, recorded before the answer).
	Record(ctx context.Context, events []audit.Event) error
	// UpdateDocument locks a live document, and writes what mutate makes of
	// it (OnEmployeeRecord, or its removal when Removed is set) with the events.
	UpdateDocument(ctx context.Context, id uuid.UUID, mutate func(cur Document) (DocumentChange, []audit.Event, error)) error
	// UpdateSubject locks the employee's subject (ErrNotFound when they have
	// no personnel file) and writes what mutate makes of its retention.
	UpdateSubject(ctx context.Context, employeeID uuid.UUID, mutate func(cur Retention) (Retention, []audit.Event, error)) error
	// Retention is the employee's personnel file's retention; false when they have no file.
	Retention(ctx context.Context, employeeID uuid.UUID) (Retention, bool, error)
	// Due are the subjects whose retention has ended by today: their
	// employment (or, without that, the employee's deletion) ended at least
	// months before, and no Legal Hold runs past today.
	Due(ctx context.Context, today string, months int) ([]uuid.UUID, error)
	// Shred deletes the subject, their data key, documents and copies' rows,
	// writes the events, and returns the copies' object keys, so their
	// objects can go too. Idempotent: an employee with no file is no error.
	Shred(ctx context.Context, employeeID uuid.UUID, events func(documents int) []audit.Event) ([]string, error)
}

// Opened is a document as Show Document opens it.
type Opened struct {
	Document  Document
	Sealed    []byte
	Copies    []Copy
	SealedKey []byte
	KeyID     int16
}

// DocumentChange is what a document becomes: its Add to Employee Record,
// or removed.
type DocumentChange struct {
	OnEmployeeRecord bool
	Removed          bool
}

// Retention is a personnel file's retention: when employment ended, and a
// Legal Hold. Dates are ISO.
type Retention struct {
	EmploymentEndedOn *string `json:"employment_ended_on"`
	HoldUntil         *string `json:"hold_until"`
	HoldReason        *string `json:"hold_reason"`
}
