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

// Repository is the persistence the catalogue service needs. Its item reads
// return live items only (a deleted one is ErrNotFound), each with its
// picture's size group. Implementations translate storage errors to this
// package's sentinels and never validate.
type Repository interface {
	// Create stores i and ev in one transaction and returns i as read back,
	// with its picture's size group; a live item's name is ErrNameTaken.
	Create(ctx context.Context, i Item, ev *audit.Event) (Item, error)
	// Get is the live item, or ErrNotFound.
	Get(ctx context.Context, id uuid.UUID) (Item, error)
	// List returns every live item, active or not, in selector order.
	List(ctx context.Context) ([]Item, error)
	// ListActive returns live, active items by display_rank then name.
	ListActive(ctx context.Context) ([]Item, error)
	// Update locks the live item (ErrNotFound), applies m and writes the item
	// with its events, whether or not m changed anything (Delete is an Update
	// that sets DeletedAt). It returns the item as read back after the write,
	// so a changed picture brings its size group.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (Item, error)
	// Reorder locks every live item, applies m and writes the items it changed
	// with their events, then returns every live item in display order.
	Reorder(ctx context.Context, m OrderMutation) ([]Item, error)
	// PriceHistory returns the item's created and price-changed audit events
	// as PriceEntry values, newest first.
	PriceHistory(ctx context.Context, id uuid.UUID) ([]PriceEntry, error)

	// Pictures returns every picture in Icons order, with its live items counted.
	Pictures(ctx context.Context) ([]Picture, error)
	// UpdatePicture locks the picture (ErrPictureNotFound), applies m and,
	// when m returns events, writes it with them; no events writes nothing.
	UpdatePicture(ctx context.Context, icon Icon, m PictureMutation) (Picture, error)
}
