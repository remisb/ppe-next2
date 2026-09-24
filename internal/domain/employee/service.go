package employee

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Audit event names and entity type written by this service.
const (
	EventCreated      = "employee.created"
	EventSizesChanged = "employee.sizes_changed"
	EventDeleted      = "employee.deleted"
	auditEntity       = "employee"
	searchLimit       = 50
)

type Service struct {
	repo  Repository
	now   func() time.Time
	newID func() uuid.UUID
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{repo: repo, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New}
	for _, o := range opts {
		o(s)
	}
	return s
}

// sizeSnapshot is what size audit events record.
type sizeSnapshot struct {
	HeightCm     *int    `json:"height_cm"`
	ClothingSize *string `json:"clothing_size"`
	ShoeSize     *string `json:"shoe_size"`
}

func snapshotOf(e Employee) sizeSnapshot {
	return sizeSnapshot{HeightCm: e.HeightCm, ClothingSize: e.ClothingSize, ShoeSize: e.ShoeSize}
}

func (a sizeSnapshot) equal(b sizeSnapshot) bool {
	return eqPtr(a.HeightCm, b.HeightCm) && eqPtr(a.ClothingSize, b.ClothingSize) && eqPtr(a.ShoeSize, b.ShoeSize)
}

func eqPtr[T comparable](a, b *T) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func (s *Service) event(actor uuid.UUID, name string, id uuid.UUID, at time.Time, before, after any) (*audit.Event, error) {
	ev, err := audit.New(s.newID(), &actor, name, auditEntity, id, at, before, after)
	if err != nil {
		return nil, err
	}
	return &ev, nil
}

// Create adds an employee. Only first and last name are required.
func (s *Service) Create(ctx context.Context, p Params, actor uuid.UUID) (Employee, error) {
	if actor == uuid.Nil {
		return Employee{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return Employee{}, err
	}
	now := s.now()
	e := Employee{
		ID: s.newID(), FirstName: p.FirstName, LastName: p.LastName, Code: p.Code,
		HeightCm: p.HeightCm, ClothingSize: p.ClothingSize, ShoeSize: p.ShoeSize, Notes: p.Notes,
		CreatedAt: now, UpdatedAt: now, CreatedByUserID: actor, UpdatedByUserID: actor,
	}
	ev, err := s.event(actor, EventCreated, e.ID, now, nil, snapshotOf(e))
	if err != nil {
		return Employee{}, err
	}
	if err := s.repo.Create(ctx, e, ev); err != nil {
		return Employee{}, err
	}
	return e, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Employee, error) {
	return s.repo.Get(ctx, id)
}

func (s *Service) List(ctx context.Context) ([]Employee, error) {
	return s.repo.List(ctx)
}

// Search is the Assigned to selector's filter. A blank query matches nothing.
func (s *Service) Search(ctx context.Context, q string) ([]Employee, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return make([]Employee, 0), nil
	}
	return s.repo.SearchByName(ctx, q, searchLimit)
}

// Update replaces every mutable field. A change to any size default records
// employee.sizes_changed; it never touches existing orders, which hold snapshots.
func (s *Service) Update(ctx context.Context, id uuid.UUID, p Params, actor uuid.UUID) (Employee, error) {
	if actor == uuid.Nil {
		return Employee{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return Employee{}, err
	}
	return s.repo.Update(ctx, id, func(cur Employee) (Employee, *audit.Event, error) {
		next := cur
		next.FirstName, next.LastName, next.Code, next.Notes = p.FirstName, p.LastName, p.Code, p.Notes
		next.HeightCm, next.ClothingSize, next.ShoeSize = p.HeightCm, p.ClothingSize, p.ShoeSize
		return s.touch(cur, next, actor)
	})
}

// UpdateSizes is Edit Sizes and Save as Employee Default: it replaces only the
// three size defaults.
func (s *Service) UpdateSizes(ctx context.Context, id uuid.UUID, p SizesParams, actor uuid.UUID) (Employee, error) {
	if actor == uuid.Nil {
		return Employee{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return Employee{}, err
	}
	return s.repo.Update(ctx, id, func(cur Employee) (Employee, *audit.Event, error) {
		next := cur
		next.HeightCm, next.ClothingSize, next.ShoeSize = p.HeightCm, p.ClothingSize, p.ShoeSize
		return s.touch(cur, next, actor)
	})
}

// touch stamps next and builds the sizes_changed event when sizes differ.
func (s *Service) touch(cur, next Employee, actor uuid.UUID) (Employee, *audit.Event, error) {
	now := s.now()
	next.UpdatedAt, next.UpdatedByUserID = now, actor
	before, after := snapshotOf(cur), snapshotOf(next)
	if before.equal(after) {
		return next, nil, nil
	}
	ev, err := s.event(actor, EventSizesChanged, cur.ID, now, before, after)
	return next, ev, err
}

// Delete soft-deletes an employee. Their orders keep their snapshots.
func (s *Service) Delete(ctx context.Context, id uuid.UUID, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	_, err := s.repo.Update(ctx, id, func(cur Employee) (Employee, *audit.Event, error) {
		now := s.now()
		next := cur
		next.DeletedAt, next.DeletedByUserID = &now, &actor
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		ev, err := s.event(actor, EventDeleted, cur.ID, now, nil, nil)
		return next, ev, err
	})
	return err
}
