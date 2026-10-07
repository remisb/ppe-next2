package audit

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Store reads the trail. Implementations translate storage errors and never
// validate: Service resolves every Query first.
type Store interface {
	// List returns up to q.Limit events matching q, newest first, after
	// q.After when it is set.
	List(ctx context.Context, q Query) ([]Entry, error)
}

// Service is the Audit log's read side. Writing stays with the domains,
// through Insert inside their own transactions.
type Service struct {
	store Store
	loc   *time.Location
}

type Option func(*Service)

// WithLocation sets the organisation's timezone, in which from and to are
// calendar days. The default is UTC.
func WithLocation(loc *time.Location) Option { return func(s *Service) { s.loc = loc } }

func NewService(store Store, opts ...Option) *Service {
	s := &Service{store: store, loc: time.UTC}
	for _, o := range opts {
		o(s)
	}
	return s
}

// List is one page of the Audit log, newest first.
func (s *Service) List(ctx context.Context, f Filter) (Page, error) {
	q, err := f.resolve(s.loc)
	if err != nil {
		return Page{}, err
	}
	// One more than the page shows tells whether another page follows.
	limit := q.Limit
	q.Limit++
	rows, err := s.store.List(ctx, q)
	if err != nil {
		return Page{}, err
	}
	page := Page{Events: rows}
	if len(rows) > limit {
		page.Events = rows[:limit]
		last := page.Events[limit-1]
		next := Cursor{At: last.OccurredAt, ID: last.ID}.String()
		page.Next = &next
	}
	if page.Events == nil {
		page.Events = make([]Entry, 0)
	}
	return page, nil
}

// Get is one event, or ErrNotFound.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Entry, error) {
	rows, err := s.store.List(ctx, Query{ID: &id, Limit: 1})
	if err != nil {
		return Entry{}, err
	}
	if len(rows) == 0 {
		return Entry{}, ErrNotFound
	}
	return rows[0], nil
}

// History is one record's events, newest first, at most HistoryLimit. The
// caller checks that the record exists and that the user may read it.
func (s *Service) History(ctx context.Context, entityType string, id uuid.UUID) ([]Entry, error) {
	if AreaOf(entityType) == "" {
		return nil, fieldError("entity_type", "is not known")
	}
	rows, err := s.store.List(ctx, Query{EntityTypes: []string{entityType}, EntityID: &id, Limit: HistoryLimit})
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = make([]Entry, 0)
	}
	return rows, nil
}
