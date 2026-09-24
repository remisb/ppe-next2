package itemset

import (
	"context"

	"github.com/google/uuid"
)

// Repository stores item sets with their lines. Lines are owned by the set and
// written with it in one transaction.
type Repository interface {
	Create(ctx context.Context, s ItemSet) error
	Get(ctx context.Context, id uuid.UUID) (ItemSet, error)
	// List returns live sets (active or not) by name; ListActive only active ones.
	List(ctx context.Context) ([]ItemSet, error)
	ListActive(ctx context.Context) ([]ItemSet, error)
	// Update replaces the set's fields and all of its lines.
	Update(ctx context.Context, s ItemSet) error
	Delete(ctx context.Context, s ItemSet) error
}

// CatalogueChecker is the one question this package asks of the catalogue.
// The composition root adapts the catalogue service to it.
type CatalogueChecker interface {
	// MissingItems returns the ids that do not name a live catalogue item.
	MissingItems(ctx context.Context, ids []uuid.UUID) ([]uuid.UUID, error)
}
