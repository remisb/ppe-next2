package settings

import (
	"context"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Mutation computes the new settings from the current, locked ones and the
// audit event to record with them (nil for none). A returned error aborts the write.
type Mutation func(cur Settings) (Settings, *audit.Event, error)

// Repository stores the organisation's one set of settings. Implementations
// translate storage errors to this package's sentinels and never validate.
type Repository interface {
	// Get returns the settings, or the zero Settings when none are stored.
	Get(ctx context.Context) (Settings, error)
	// Update locks the settings (the zero Settings when none are stored),
	// applies m and, when m returns an event, writes the result (inserting the
	// row the first time, the providers again when they changed) and the
	// event; no event writes nothing.
	Update(ctx context.Context, m Mutation) (Settings, error)
}
