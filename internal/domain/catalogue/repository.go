package catalogue

import (
	"context"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Mutation computes an item's new state from its current, locked state plus
// the audit event to record (nil for none). See employee.Mutation.
type Mutation func(cur Item) (Item, *audit.Event, error)

type Repository interface {
	Create(ctx context.Context, i Item, ev *audit.Event) error
	Get(ctx context.Context, id uuid.UUID) (Item, error)
	// List returns every live item, active or not, in selector order.
	List(ctx context.Context) ([]Item, error)
	// ListActive returns live, active items by display_rank then name.
	ListActive(ctx context.Context) ([]Item, error)
	Update(ctx context.Context, id uuid.UUID, m Mutation) (Item, error)
}
