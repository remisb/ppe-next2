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
// written with it in one transaction. Its reads return live sets only (a
// deleted one is ErrNotFound), lines in display order. Implementations
// translate storage errors to this package's sentinels and never validate.
type Repository interface {
	// Create writes the set, its lines and ev; a live set's name is
	// ErrNameTaken, an unknown item ErrUnknownItem.
	Create(ctx context.Context, s ItemSet, ev audit.Event) error
	// Get is the live set with its lines, or ErrNotFound.
	Get(ctx context.Context, id uuid.UUID) (ItemSet, error)
	// List returns live sets (active or not) by name, ignoring case.
	List(ctx context.Context) ([]ItemSet, error)
	// ListActive is List's active sets only.
	ListActive(ctx context.Context) ([]ItemSet, error)
	// Update locks live set id (ErrNotFound) and reads its lines, applies m
	// and writes the result (its fields, all of its lines unless m deleted it,
	// and a deletion) with its events, whether or not m changed anything.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (ItemSet, error)
}

// CatalogueChecker is the one question this package asks of the catalogue.
// The composition root adapts the catalogue service to it.
type CatalogueChecker interface {
	// MissingItems returns the ids that do not name a live catalogue item.
	MissingItems(ctx context.Context, ids []uuid.UUID) ([]uuid.UUID, error)
}
