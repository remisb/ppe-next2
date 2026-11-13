package itemset

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Audit event names and entity type written by this service.
const (
	// EventCreated: a new set; its after is the whole set (snapshotOf).
	EventCreated = "item_set.created"
	// EventUpdated: the changed fields before and after, the whole line list
	// when any line changed.
	EventUpdated = "item_set.updated"
	// EventDeleted: a soft delete.
	EventDeleted = "item_set.deleted"
	auditEntity  = "item_set"
)

// lineSnapshot is how events record a set's lines, in display order.
type lineSnapshot struct {
	CatalogueItemID uuid.UUID `json:"catalogue_item_id"`
	DefaultQuantity int       `json:"default_quantity"`
}

// linesOf is set's lines as events record them.
func linesOf(set ItemSet) []lineSnapshot {
	out := make([]lineSnapshot, len(set.Lines))
	for i, l := range set.Lines {
		out[i] = lineSnapshot{l.CatalogueItemID, l.DefaultQuantity}
	}
	return out
}

// snapshotOf is everything item_set.created records.
func snapshotOf(set ItemSet) map[string]any {
	return map[string]any{"name": set.Name, "description": set.Description, "active": set.Active, "lines": linesOf(set)}
}

// change is what item_set.updated records: the changed fields, before and after.
func change(cur, next ItemSet) (before, after map[string]any) {
	before, after = map[string]any{}, map[string]any{}
	set := func(key string, changed bool, b, a any) {
		if changed {
			before[key], after[key] = b, a
		}
	}
	set("name", cur.Name != next.Name, cur.Name, next.Name)
	set("description", cur.Description != next.Description, cur.Description, next.Description)
	set("active", cur.Active != next.Active, cur.Active, next.Active)
	set("lines", !slices.Equal(linesOf(cur), linesOf(next)), linesOf(cur), linesOf(next))
	return before, after
}

// event is one audit event on the set id by actor.
func (s *Service) event(actor uuid.UUID, name string, id uuid.UUID, at time.Time, before, after any) ([]audit.Event, error) {
	ev, err := audit.New(s.newID(), &actor, name, auditEntity, id, at, before, after)
	if err != nil {
		return nil, err
	}
	return []audit.Event{ev}, nil
}

// Service holds the Item Sets use cases.
type Service struct {
	repo    Repository
	catalog CatalogueChecker
	now     func() time.Time
	newID   func() uuid.UUID
}

// Option configures a Service.
type Option func(*Service)

// WithClock replaces the clock (UTC, microseconds, as Postgres stores them).
func WithClock(now func() time.Time) Option { return func(s *Service) { s.now = now } }

// WithIDGenerator replaces uuid.New for sets and events.
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

// NewService is the item set service over repo, checking lines against the
// catalogue through catalog.
func NewService(repo Repository, catalog CatalogueChecker, opts ...Option) *Service {
	s := &Service{repo: repo, catalog: catalog, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New}
	for _, o := range opts {
		o(s)
	}
	return s
}

// checkItems rejects lines naming items that are not live in the catalogue
// (ErrUnknownItem, naming the first).
// Inactive items are allowed: activation can change after the set is saved,
// and applying the set flags such lines rather than dropping them.
func (s *Service) checkItems(ctx context.Context, p Params) error {
	ids := make([]uuid.UUID, len(p.Lines))
	for i, l := range p.Lines {
		ids[i] = l.CatalogueItemID
	}
	missing, err := s.catalog.MissingItems(ctx, ids)
	if err != nil {
		return err
	}
	if len(missing) > 0 {
		return fmt.Errorf("%w: %s", ErrUnknownItem, missing[0])
	}
	return nil
}

// Create is a new set with item_set.created; its lines must name live
// catalogue items.
func (s *Service) Create(ctx context.Context, p Params, actor uuid.UUID) (ItemSet, error) {
	if actor == uuid.Nil {
		return ItemSet{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return ItemSet{}, err
	}
	if err := s.checkItems(ctx, p); err != nil {
		return ItemSet{}, err
	}
	now := s.now()
	set := ItemSet{
		ID: s.newID(), Name: p.Name, Description: p.Description, Active: p.Active, Lines: p.ToLines(),
		CreatedAt: now, UpdatedAt: now, CreatedByUserID: actor, UpdatedByUserID: actor,
	}
	evs, err := s.event(actor, EventCreated, set.ID, now, nil, snapshotOf(set))
	if err != nil {
		return ItemSet{}, err
	}
	if err := s.repo.Create(ctx, set, evs[0]); err != nil {
		return ItemSet{}, err
	}
	return set, nil
}

// Get is the live set with its lines, or ErrNotFound.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (ItemSet, error) { return s.repo.Get(ctx, id) }

// List is every live set, active or not, by name: the Item Sets screen.
func (s *Service) List(ctx context.Context) ([]ItemSet, error) { return s.repo.List(ctx) }

// ListActive feeds Create Order's Item Set selector, open to every signed-in
// user.
func (s *Service) ListActive(ctx context.Context) ([]ItemSet, error) { return s.repo.ListActive(ctx) }

// Update replaces every field and the whole line list, recording what changed
// (item_set.updated; nothing when nothing did). Every line must name a live
// catalogue item, so a set holding a since-deleted item must leave it out
// (ErrUnknownItem otherwise).
func (s *Service) Update(ctx context.Context, id uuid.UUID, p Params, actor uuid.UUID) (ItemSet, error) {
	if actor == uuid.Nil {
		return ItemSet{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return ItemSet{}, err
	}
	if err := s.checkItems(ctx, p); err != nil {
		return ItemSet{}, err
	}
	return s.repo.Update(ctx, id, func(cur ItemSet) (ItemSet, []audit.Event, error) {
		next := cur
		next.Name, next.Description, next.Active, next.Lines = p.Name, p.Description, p.Active, p.ToLines()
		now := s.now()
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		before, after := change(cur, next)
		if len(after) == 0 {
			return next, nil, nil
		}
		evs, err := s.event(actor, EventUpdated, cur.ID, now, before, after)
		return next, evs, err
	})
}

// Delete soft-deletes a set with item_set.deleted; its lines stay with it and
// its name is free again.
func (s *Service) Delete(ctx context.Context, id uuid.UUID, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	_, err := s.repo.Update(ctx, id, func(cur ItemSet) (ItemSet, []audit.Event, error) {
		now := s.now()
		next := cur
		next.DeletedAt, next.DeletedByUserID = &now, &actor
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		evs, err := s.event(actor, EventDeleted, cur.ID, now, nil, nil)
		return next, evs, err
	})
	return err
}
