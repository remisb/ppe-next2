package document

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/vault"
)

// Change is what a Mutation decides: the document's new fields, its links
// (the whole set), and the events to record (none writes nothing).
type Change struct {
	Document Document
	Links    []Link
	Events   []audit.Event
}

// Mutation computes a change from a document's current, locked state.
type Mutation func(cur Document) (Change, error)

// VersionMutation computes the next version of a locked document (its number
// is the newest's plus one) and the events to record.
type VersionMutation func(cur Document) (Version, []audit.Event, error)

// Subject is a linked record as the repository refreshes it.
type Subject struct {
	Kind vault.SubjectKind
	ID   uuid.UUID
}

// Repository is the documents' persistence. Reads return live documents
// only; implementations translate storage errors to this package's sentinels
// and rebuild a document's search vector after every write.
type Repository interface {
	// Create stores a new document with its first version, file and links,
	// and ev, in one transaction.
	Create(ctx context.Context, d Document, links []Link, ev audit.Event) error
	// Get is the live document with its versions (newest first) and links, or ErrNotFound.
	Get(ctx context.Context, id uuid.UUID) (Document, error)
	// Update locks the live document (ErrNotFound), applies m and, when it
	// returns events, writes the document's fields and links with them.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (Document, error)
	// AddVersion locks the live document, applies m and writes the version,
	// its file and the events.
	AddVersion(ctx context.Context, id uuid.UUID, m VersionMutation) (Document, error)
	// Search is a page of live documents whose requires the reader holds.
	Search(ctx context.Context, q Query, perms []string) (Page, error)
	// Subjects are every subject some live document is linked to.
	Subjects(ctx context.Context) ([]Subject, error)
	// Relabel sets the label of every link to subject, and rebuilds the search
	// of the documents whose label changed; it returns how many changed.
	Relabel(ctx context.Context, s Subject, label string) (int, error)
	// NextNumber takes the next number of type in year (1, 2, …), never given twice.
	NextNumber(ctx context.Context, typ string, year int) (int, error)
	// Record writes an event that changes nothing (a sealed document opened).
	Record(ctx context.Context, ev audit.Event) error
	// Retained are the documents not shredded yet, removed ones included,
	// that are sealed or of one of types (those whose retention shreds).
	Retained(ctx context.Context, types []string) ([]Candidate, error)
	// SetRetainUntil sets a document's retain_until.
	SetRetainUntil(ctx context.Context, id uuid.UUID, day *string) error
	// Shred makes a document unreadable for good (vault.shred_document) and
	// records ev in one transaction, returning its files' object keys.
	Shred(ctx context.Context, id uuid.UUID, at time.Time, day string, ev audit.Event) ([]string, error)
	// VersionDocument is the document a version is of, or ErrNotFound.
	VersionDocument(ctx context.Context, version uuid.UUID) (uuid.UUID, error)
	// SetText keeps what reading made of a version and rebuilds its document's search.
	SetText(ctx context.Context, version uuid.UUID, t TextUpdate) error
	// ReadAgain makes a version's text pending and writes its job, in one transaction.
	ReadAgain(ctx context.Context, version uuid.UUID, at time.Time) error
	// QueueUnread writes a job for every live version whose text is pending
	// or being read (and failed, when failed); how many were written.
	QueueUnread(ctx context.Context, failed bool, at time.Time) (int64, error)
	// SourceDocument is the live document of source kind's record id, or ErrNotFound.
	SourceDocument(ctx context.Context, kind string, id uuid.UUID) (uuid.UUID, error)
	// AddSourced makes d (with its links) unless its source has a document,
	// locks the source's document, applies m and writes the version and the
	// events, in one transaction.
	AddSourced(ctx context.Context, d Document, m VersionMutation) (Document, error)
	// SourcedFiles are the versions of the live documents of source kind's
	// records ids, by source and newest first.
	SourcedFiles(ctx context.Context, kind string, ids []uuid.UUID) ([]SourcedFile, error)
	// Sources are the records of source kind that have a live document.
	Sources(ctx context.Context, kind string) ([]uuid.UUID, error)
	// QueueArchives writes an archiving job (KindArchive) for each of ids,
	// records of source kind, that has no document yet, unless one is waiting,
	// and answers how many it wrote.
	QueueArchives(ctx context.Context, kind string, ids []uuid.UUID, now time.Time) (int64, error)
	// Unarchived are those of ids, records of source kind, with no document.
	Unarchived(ctx context.Context, kind string, ids []uuid.UUID) ([]uuid.UUID, error)
}

// Candidate is a document as the retention sees it.
type Candidate struct {
	ID           uuid.UUID
	Type         string
	Number       *string
	DocumentDate *string
	RetainUntil  *string
	HoldUntil    *string
	Removed      bool
	Sealed       bool
	Employees    []uuid.UUID
	// SourceKind and SourceID are a sourced document's record.
	SourceKind *string
	SourceID   *uuid.UUID
}
