package share

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Mutation computes a link's new state from its current, locked state plus
// the audit events to record.
type Mutation func(cur Share) (Share, []audit.Event, error)

// Repository is the persistence the share service needs. Implementations
// translate storage errors to this package's sentinels and never validate.
type Repository interface {
	// Create stores s and ev in one transaction and returns s as read back.
	Create(ctx context.Context, s Share, ev audit.Event) (Share, error)
	// ByTokenHash is the link with that hash, rows included, or ErrNotFound.
	ByTokenHash(ctx context.Context, hash string) (Share, error)
	// ListOpen is actor's links neither revoked nor expired at now, newest
	// first, without their rows.
	ListOpen(ctx context.Context, actor uuid.UUID, now time.Time) ([]Share, error)
	// Update locks the link (ErrNotFound), applies m and writes its
	// revocation and erasure with m's events.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (Share, error)
	// EraseExpired empties the rows of every link expired by now and not yet
	// erased, setting erased_at to now, and says how many.
	EraseExpired(ctx context.Context, now time.Time) (int, error)
}
