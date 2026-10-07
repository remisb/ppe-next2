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
	EventCreated = "item_set.created"
	EventUpdated = "item_set.updated"
	EventDeleted = "item_set.deleted"
	auditEntity  = "item_set"
)

// lineSnapshot is how events record a set's lines, in display order.
type lineSnapshot struct {
	CatalogueItemID uuid.UUID `json:"catalogue_item_id"`
	DefaultQuantity int       `json:"default_quantity"`
}

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

func (s *Service) event(actor uuid.UUID, name string, id uuid.UUID, at time.Time, before, after any) ([]audit.Event, error) {
	ev, err := audit.New(s.newID(), &actor, name, auditEntity, id, at, before, after)
	if err != nil {
		return nil, err
	}
	return []audit.Event{ev}, nil
}

type Service struct {
	repo    Repository
	catalog CatalogueChecker
	now     func() time.Time
	newID   func() uuid.UUID
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

func NewService(repo Repository, catalog CatalogueChecker, opts ...Option) *Service {
	s := &Service{repo: repo, catalog: catalog, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New}
	for _, o := range opts {
		o(s)
	}
	return s
}

// checkItems rejects lines naming items that are not live in the catalogue.
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

func (s *Service) Get(ctx context.Context, id uuid.UUID) (ItemSet, error) { return s.repo.Get(ctx, id) }
func (s *Service) List(ctx context.Context) ([]ItemSet, error)            { return s.repo.List(ctx) }

// ListActive feeds the Item Set selector.
func (s *Service) ListActive(ctx context.Context) ([]ItemSet, error) { return s.repo.ListActive(ctx) }

// Update replaces every field and the whole line list, recording what changed
// (item_set.updated; nothing when nothing did).
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
