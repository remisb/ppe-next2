package launcher

import (
	"context"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Mutation computes a tile's new state from its current, locked one and the
// events to record (none when nothing changed). A returned error aborts.
type Mutation func(cur App) (App, []audit.Event, error)

// OrderMutation computes, from every tile in order (locked), the tiles whose
// position changes and the events to record.
type OrderMutation func(cur []App) (changed []App, evs []audit.Event, err error)

// ChannelMutation computes a channel's new state from its current, locked one
// (nil when the app has no channel by that name yet) and the events to record.
type ChannelMutation func(cur *Channel) (Channel, []audit.Event, error)

// PruneMutation picks, from an app's versions (newest first) and its
// channels, read under the app's lock, the versions to remove and the event
// that records it (nil when none go).
type PruneMutation func(versions []Version, channels []Channel) (remove []Version, ev *audit.Event, err error)

// Repository stores tiles in launcher_apps, pins in launcher_pins and
// feedback in launcher_feedback (migration 0042), versions, channels and
// channel choices (0043). Implementations translate storage errors to this
// package's sentinels and never validate.
type Repository interface {
	// List returns every tile, retired ones included, by position.
	List(ctx context.Context) ([]App, error)
	Get(ctx context.Context, slug string) (App, error)
	Create(ctx context.Context, a App, ev audit.Event) (App, error)
	// Update locks the tile, applies m and writes it with its events.
	Update(ctx context.Context, slug string, m Mutation) (App, error)
	// Reorder locks every tile, applies m and writes the changed positions
	// with their events, then returns every tile by position.
	Reorder(ctx context.Context, m OrderMutation) ([]App, error)

	// Pins returns the slugs a user pinned, in the order pinned.
	Pins(ctx context.Context, user uuid.UUID) ([]string, error)
	// SetPins replaces a user's pins with these tiles, in this order.
	SetPins(ctx context.Context, user uuid.UUID, apps []uuid.UUID) error

	// Versions returns an app's published versions, newest first.
	Versions(ctx context.Context, app uuid.UUID) ([]Version, error)
	// AddVersion stores a newly published version with its event.
	AddVersion(ctx context.Context, v Version, ev audit.Event) error
	// PruneVersions locks the app (as PutChannel does), applies m and deletes
	// the versions it picks with its event, returning them.
	PruneVersions(ctx context.Context, app uuid.UUID, m PruneMutation) ([]Version, error)
	// Channels returns every app's channels, each with its version's name.
	Channels(ctx context.Context) ([]Channel, error)
	// PutChannel locks the app's channel by that name, applies m and writes
	// the result with its events.
	PutChannel(ctx context.Context, app uuid.UUID, name string, m ChannelMutation) (Channel, error)
	// Choices returns the channel a user chose for each app, by app id.
	Choices(ctx context.Context, user uuid.UUID) (map[uuid.UUID]string, error)
	// SetChoice keeps the channel a user opens an app on; "" removes it.
	SetChoice(ctx context.Context, user, app uuid.UUID, channel string) error

	AddFeedback(ctx context.Context, f Feedback) error
	// Feedback returns an app's feedback, newest first, with each sender's name.
	Feedback(ctx context.Context, app uuid.UUID) ([]Feedback, error)
}
