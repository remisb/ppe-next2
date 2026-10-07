package system

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Store is the error list's and the database status's persistence.
// Implementations translate storage errors and never validate.
type Store interface {
	// RecordError adds one occurrence of ev: to the newest row with its
	// fingerprint last seen at or after foldSince (count, last_seen and the
	// last_* columns), else as a new row.
	RecordError(ctx context.Context, ev ErrorEvent, foldSince time.Time) error
	// ListErrors returns up to q.Limit rows matching q, last seen first.
	ListErrors(ctx context.Context, q ErrorQuery) ([]ErrorEvent, error)
	// NewErrorKinds counts the fingerprints first seen at or after since and
	// on no row before it.
	NewErrorKinds(ctx context.Context, since time.Time) (int, error)
	// PurgeErrors deletes the rows last seen before before.
	PurgeErrors(ctx context.Context, before time.Time) (int64, error)
	// Database reads the database's status, with the size sample from at
	// least GrowthSpan before now.
	Database(ctx context.Context, now time.Time) (Database, error)
	// SampleSize records the database's size for day (replacing that day's).
	SampleSize(ctx context.Context, day time.Time) error
}

// Service records and reads the error list and the database's status.
type Service struct {
	store    Store
	now      func() time.Time
	newID    func() uuid.UUID
	recorded func(Kind)
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

// WithRecorded calls f with the kind of every error recorded (the metrics).
func WithRecorded(f func(Kind)) Option { return func(s *Service) { s.recorded = f } }

func NewService(store Store, opts ...Option) *Service {
	s := &Service{
		store:    store,
		now:      func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) },
		newID:    uuid.New,
		recorded: func(Kind) {},
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Record puts one occurrence of r on the error list, with the request ctx
// carries (audit.RequestFrom): its ID, app, signed-in user and browser.
func (s *Service) Record(ctx context.Context, r Report) error {
	r, err := r.check()
	if err != nil {
		return err
	}
	req := audit.RequestFrom(ctx)
	now := s.now()
	ev := ErrorEvent{
		ID: s.newID(), Fingerprint: fingerprint(r), Kind: r.Kind, Route: r.Route, Method: r.Method,
		Message: r.Message, Stack: r.Stack, FirstSeen: now, LastSeen: now, Count: 1,
	}
	if r.Status != 0 {
		ev.Status = &r.Status
	}
	src := req.Source
	ev.Source = &src
	if req.ID != "" {
		ev.LastRequestID = &req.ID
	}
	if req.UserID != uuid.Nil {
		ev.LastUserID = &req.UserID
	}
	if req.UserAgent != "" {
		ua := cut(req.UserAgent, maxAgent)
		ev.LastUserAgent = &ua
	}
	if err := s.store.RecordError(ctx, ev, now.Add(-FoldWithin)); err != nil {
		return err
	}
	s.recorded(r.Kind)
	return nil
}

// Errors is one page of the error list, the latest occurrence first.
func (s *Service) Errors(ctx context.Context, f ErrorFilter) (ErrorPage, error) {
	switch {
	case f.Kind != "" && !IsKind(f.Kind):
		return ErrorPage{}, fieldError("kind", "is not known")
	case f.PageSize < 0 || f.PageSize > audit.MaxPageSize:
		return ErrorPage{}, fieldError("page_size", fmt.Sprintf("must be between 1 and %d", audit.MaxPageSize))
	}
	limit := f.PageSize
	if limit == 0 {
		limit = audit.DefaultPageSize
	}
	rows, err := s.store.ListErrors(ctx, ErrorQuery{Kind: f.Kind, After: f.After, Limit: limit + 1})
	if err != nil {
		return ErrorPage{}, err
	}
	page := ErrorPage{Errors: rows}
	if len(rows) > limit {
		page.Errors = rows[:limit]
		last := page.Errors[limit-1]
		next := audit.Cursor{At: last.LastSeen, ID: last.ID}.String()
		page.Next = &next
	}
	if page.Errors == nil {
		page.Errors = make([]ErrorEvent, 0)
	}
	return page, nil
}

// Error is one row of the error list, or ErrNotFound.
func (s *Service) Error(ctx context.Context, id uuid.UUID) (ErrorEvent, error) {
	rows, err := s.store.ListErrors(ctx, ErrorQuery{ID: &id, Limit: 1})
	if err != nil {
		return ErrorEvent{}, err
	}
	if len(rows) == 0 {
		return ErrorEvent{}, ErrNotFound
	}
	return rows[0], nil
}

// NewErrorKinds counts the kinds of error first seen in the last day.
func (s *Service) NewErrorKinds(ctx context.Context) (int, error) {
	return s.store.NewErrorKinds(ctx, s.now().Add(-24*time.Hour))
}

// Purge deletes the rows last seen over Retention ago.
func (s *Service) Purge(ctx context.Context) (int64, error) {
	return s.store.PurgeErrors(ctx, s.now().Add(-Retention))
}

// Database is the database's status now.
func (s *Service) Database(ctx context.Context) (Database, error) {
	return s.store.Database(ctx, s.now())
}

// SampleSize records today's size of the database (UTC days).
func (s *Service) SampleSize(ctx context.Context) error {
	return s.store.SampleSize(ctx, s.now().Truncate(24*time.Hour))
}
