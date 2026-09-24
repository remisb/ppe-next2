package itemset

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

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
	s := &Service{repo: repo, catalog: catalog, now: func() time.Time { return time.Now().UTC() }, newID: uuid.New}
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
	if err := s.repo.Create(ctx, set); err != nil {
		return ItemSet{}, err
	}
	return set, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (ItemSet, error) { return s.repo.Get(ctx, id) }
func (s *Service) List(ctx context.Context) ([]ItemSet, error)            { return s.repo.List(ctx) }

// ListActive feeds the Item Set selector.
func (s *Service) ListActive(ctx context.Context) ([]ItemSet, error) { return s.repo.ListActive(ctx) }

// Update replaces every field and the whole line list.
func (s *Service) Update(ctx context.Context, id uuid.UUID, p Params, actor uuid.UUID) (ItemSet, error) {
	if actor == uuid.Nil {
		return ItemSet{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return ItemSet{}, err
	}
	cur, err := s.repo.Get(ctx, id)
	if err != nil {
		return ItemSet{}, err
	}
	if err := s.checkItems(ctx, p); err != nil {
		return ItemSet{}, err
	}
	cur.Name, cur.Description, cur.Active, cur.Lines = p.Name, p.Description, p.Active, p.ToLines()
	cur.UpdatedAt, cur.UpdatedByUserID = s.now(), actor
	if err := s.repo.Update(ctx, cur); err != nil {
		return ItemSet{}, err
	}
	return cur, nil
}

func (s *Service) Delete(ctx context.Context, id uuid.UUID, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	cur, err := s.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	now := s.now()
	cur.DeletedAt, cur.DeletedByUserID = &now, &actor
	cur.UpdatedAt, cur.UpdatedByUserID = now, actor
	return s.repo.Delete(ctx, cur)
}
