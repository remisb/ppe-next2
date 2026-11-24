package document

import (
	"context"

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
}
