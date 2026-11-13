package scan

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Record is a kept scan's row: everything but its object, which the files
// store keeps sealed under object_key.
type Record struct {
	ID        uuid.UUID
	CreatedBy uuid.UUID
	CreatedAt time.Time
	ExpiresAt time.Time
	ObjectKey string
	// Bytes and SHA256 are the plain zip's, checked on opening.
	Bytes  int
	SHA256 []byte
	// SealedKey is the scan's data key sealed by the master keyring (KeyID).
	SealedKey  []byte
	KeyID      int16
	SealedMeta []byte
	Pages      int
}

// Repository keeps kept scans' rows (personnel.scans). Removing one is a
// hard delete: the row holds the only key to the object.
type Repository interface {
	// Insert writes the row and its events in one transaction.
	Insert(ctx context.Context, rec Record, events []audit.Event) error
	// Live are owner's scans not expired at now, newest first ([] when none).
	Live(ctx context.Context, owner uuid.UUID, now time.Time) ([]Record, error)
	// Get is owner's scan by id, not expired at now; ErrNotFound otherwise.
	Get(ctx context.Context, id, owner uuid.UUID, now time.Time) (Record, error)
	// Record writes events alone (a download's, recorded before the answer).
	Record(ctx context.Context, events []audit.Event) error
	// Delete deletes owner's live scan by id with the events events makes of
	// it, in one transaction, and returns the row; ErrNotFound when there is none.
	Delete(ctx context.Context, id, owner uuid.UUID, now time.Time, events func(Record) ([]audit.Event, error)) (Record, error)
	// DeleteExpired deletes every scan expired at now and returns their
	// object keys, so their objects can go too.
	DeleteExpired(ctx context.Context, now time.Time) ([]string, error)
}
