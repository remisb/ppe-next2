package itemset

import (
	"context"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Mutation computes a set's new state, lines included, from its current,
// locked state, plus the audit events to record. See employee.Mutation.
type Mutation func(cur ItemSet) (ItemSet, []audit.Event, error)

// Repository stores item sets with their lines. Lines are owned by the set and
// written with it in one transaction.
type Repository interface {
	// Create writes the set, its lines and ev.
	Create(ctx context.Context, s ItemSet, ev audit.Event) error
	Get(ctx context.Context, id uuid.UUID) (ItemSet, error)
	// List returns live sets (active or not) by name; ListActive only active ones.
	List(ctx context.Context) ([]ItemSet, error)
	ListActive(ctx context.Context) ([]ItemSet, error)
	// Update locks live set id, applies m and writes the result (its fields,
	// all of its lines, and a deletion) with its events.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (ItemSet, error)
}

// CatalogueChecker is the one question this package asks of the catalogue.
// The composition root adapts the catalogue service to it.
type CatalogueChecker interface {
	// MissingItems returns the ids that do not name a live catalogue item.
	MissingItems(ctx context.Context, ids []uuid.UUID) ([]uuid.UUID, error)
}
