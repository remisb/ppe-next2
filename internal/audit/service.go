package audit

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Store reads the trail, writes the Audit log's own events, and keeps the
// seals and purges. Implementations translate storage errors and never
// validate: Service resolves every Query first.
type Store interface {
	// List returns up to q.Limit events matching q, newest first, after
	// q.After when it is set.
	List(ctx context.Context, q Query) ([]Entry, error)
	// Insert writes ev on its own (an export's record).
	Insert(ctx context.Context, ev Event) error
	SealStore
}

// Service is the Audit log's read side, its export, the daily seals and the
// retention purge. Writing stays with the domains, through Insert inside
// their own transactions.
type Service struct {
	store     Store
	seals     SealStore
	loc       *time.Location
	now       func() time.Time
	newID     func() uuid.UUID
	retention time.Duration

	mu               sync.Mutex
	lastVerification *Verification
}

type Option func(*Service)

// WithLocation sets the organisation's timezone, in which from and to are
// calendar days. The default is UTC.
func WithLocation(loc *time.Location) Option { return func(s *Service) { s.loc = loc } }

// WithRetention sets how long events are kept (API_AUDIT_RETENTION); 0, the
// default, purges nothing.
func WithRetention(d time.Duration) Option { return func(s *Service) { s.retention = d } }

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

func NewService(store Store, opts ...Option) *Service {
	s := &Service{
		store: store, seals: store, loc: time.UTC,
		now:   func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) },
		newID: uuid.New,
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Retention is how long events are kept; 0 for always.
func (s *Service) Retention() time.Duration { return s.retention }

// Seals are every seal, oldest day first.
func (s *Service) Seals(ctx context.Context) ([]Seal, error) { return s.seals.Seals(ctx) }

// Purges are every purge, oldest first.
func (s *Service) Purges(ctx context.Context) ([]Purge, error) { return s.seals.Purges(ctx) }

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
