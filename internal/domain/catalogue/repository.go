package catalogue

import (
	"context"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Mutation computes an item's new state from its current, locked state plus
// the audit events to record (none for none). See employee.Mutation.
type Mutation func(cur Item) (Item, []audit.Event, error)

// OrderMutation computes, from every live item in display order (locked), the
// items whose display rank changes and the events to record.
type OrderMutation func(cur []Item) (changed []Item, evs []audit.Event, err error)

// PictureMutation is Mutation for a picture.
type PictureMutation func(cur Picture) (Picture, []audit.Event, error)

type Repository interface {
	// Create stores i and returns it as read back, with its picture's size group.
	Create(ctx context.Context, i Item, ev *audit.Event) (Item, error)
	Get(ctx context.Context, id uuid.UUID) (Item, error)
	// List returns every live item, active or not, in selector order.
	List(ctx context.Context) ([]Item, error)
	// ListActive returns live, active items by display_rank then name.
	ListActive(ctx context.Context) ([]Item, error)
	// Update returns the item as read back after the write, so a changed
	// picture brings its size group.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (Item, error)
	// Reorder locks every live item, applies m and writes the items it changed
	// with their events, then returns every live item in display order.
	Reorder(ctx context.Context, m OrderMutation) ([]Item, error)
	// PriceHistory returns the item's created and price-changed audit events
	// as PriceEntry values, newest first.
	PriceHistory(ctx context.Context, id uuid.UUID) ([]PriceEntry, error)

	// Pictures returns every picture in Icons order, with its live items counted.
	Pictures(ctx context.Context) ([]Picture, error)
	// UpdatePicture locks the picture, applies m and writes it with its events.
	UpdatePicture(ctx context.Context, icon Icon, m PictureMutation) (Picture, error)
}
