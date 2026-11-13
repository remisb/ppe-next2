package employee

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Audit event names and entity type written by this service.
const (
	EventCreated      = "employee.created"
	EventUpdated      = "employee.updated"
	EventSizesChanged = "employee.sizes_changed"
	EventDeleted      = "employee.deleted"
	auditEntity       = "employee"
	// searchLimit caps Search's answer.
	searchLimit = 50
)

// Service owns the employee rules: validation, IDs, timestamps, the audit
// events of each change, the profile and size rights (Rights), the asset
// check before Delete and, in merge.go, duplicates and merging. It is built
// with NewService and stores through a Repository.
type Service struct {
	repo     Repository
	now      func() time.Time
	newID    func() uuid.UUID
	holdings Holdings
}

// Holdings answers which company assets an employee holds now, by inventory
// number (Company Assets, docs/specs/asset-service.md).
type Holdings interface {
	HeldBy(ctx context.Context, employeeID uuid.UUID) ([]string, error)
}

// Option configures a Service built by NewService.
type Option func(*Service)

// WithClock replaces the clock that stamps changes and events (tests).
func WithClock(now func() time.Time) Option { return func(s *Service) { s.now = now } }

// WithIDGenerator replaces the generator of employee and event IDs (tests).
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

// WithHoldings lets Delete refuse an employee who still holds company assets.
func WithHoldings(h Holdings) Option { return func(s *Service) { s.holdings = h } }

// NewService is a Service over repo: the clock is UTC to the microsecond (as
// Postgres keeps it), IDs are random UUIDs, and without WithHoldings Delete
// checks no company assets.
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
	ClothingSize *int    `json:"clothing_size"`
	ShoeSize     *string `json:"shoe_size"`
}

// snapshotOf is e's size defaults as the audit events record them.
func snapshotOf(e Employee) sizeSnapshot {
	return sizeSnapshot{HeightCm: e.HeightCm, ClothingSize: e.ClothingSize, ShoeSize: e.ShoeSize}
}

// equal says whether a and b hold the same sizes.
func (a sizeSnapshot) equal(b sizeSnapshot) bool {
	return eqPtr(a.HeightCm, b.HeightCm) && eqPtr(a.ClothingSize, b.ClothingSize) && eqPtr(a.ShoeSize, b.ShoeSize)
}

// eqPtr says whether a and b are both nil or point to equal values.
func eqPtr[T comparable](a, b *T) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// event is an audit event name on employee id by actor at at, with a new ID.
func (s *Service) event(actor uuid.UUID, name string, id uuid.UUID, at time.Time, before, after any) (*audit.Event, error) {
	ev, err := audit.New(s.newID(), &actor, name, auditEntity, id, at, before, after)
	if err != nil {
		return nil, err
	}
	return &ev, nil
}

// detailsChange is what employee.updated records: the changed name, code and
// language, before and after. Notes may hold personal details, so a change to
// them is recorded as notes_changed, never their text.
func detailsChange(cur, next Employee) (before, after map[string]any) {
	before, after = map[string]any{}, map[string]any{}
	set := func(key string, changed bool, b, a any) {
		if changed {
			before[key], after[key] = b, a
		}
	}
	set("first_name", cur.FirstName != next.FirstName, cur.FirstName, next.FirstName)
	set("last_name", cur.LastName != next.LastName, cur.LastName, next.LastName)
	set("code", !eqPtr(cur.Code, next.Code), cur.Code, next.Code)
	set("preferred_language", !eqPtr(cur.PreferredLanguage, next.PreferredLanguage), cur.PreferredLanguage, next.PreferredLanguage)
	if cur.Notes != next.Notes {
		after["notes_changed"] = true
	}
	return before, after
}

// Create adds an employee. Only first and last name are required. It needs
// may.Profile; without may.Sizes the employee starts with no size defaults,
// whatever p says.
func (s *Service) Create(ctx context.Context, p Params, may Rights, actor uuid.UUID) (Employee, error) {
	if actor == uuid.Nil {
		return Employee{}, fieldError("actor", "is required")
	}
	if !may.Profile {
		return Employee{}, ErrNotPermitted
	}
	if !may.Sizes {
		p.HeightCm, p.ClothingSize, p.ShoeSize = nil, nil, nil
	}
	if err := p.Validate(); err != nil {
		return Employee{}, err
	}
	now := s.now()
	e := Employee{
		ID: s.newID(), FirstName: p.FirstName, LastName: p.LastName, Code: p.Code,
		HeightCm: p.HeightCm, ClothingSize: p.ClothingSize, ShoeSize: p.ShoeSize, Notes: p.Notes,
		PreferredLanguage: p.PreferredLanguage,
		CreatedAt:         now, UpdatedAt: now, CreatedByUserID: actor, UpdatedByUserID: actor,
	}
	ev, err := s.event(actor, EventCreated, e.ID, now, nil, snapshotOf(e))
	if err != nil {
		return Employee{}, err
	}
	if err := s.repo.Create(ctx, e, ev); err != nil {
		return Employee{}, s.codeErr(ctx, err, e.Code, e.ID)
	}
	return e, nil
}

// Get is a live employee. One merged into another is a MergedError naming it.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Employee, error) {
	e, err := s.repo.Get(ctx, id)
	if err != nil {
		return Employee{}, s.mergedErr(ctx, id, err)
	}
	return e, nil
}

// codeErr is a CodeTakenError naming the live employee who has code, so Add
// New Employee can offer them; other errors are as they are.
func (s *Service) codeErr(ctx context.Context, err error, code *string, self uuid.UUID) error {
	if !errors.Is(err, ErrCodeTaken) || code == nil {
		return err
	}
	if id, ok, lookErr := s.repo.IDByCode(ctx, *code); lookErr == nil && ok && id != self {
		return &CodeTakenError{Existing: id}
	}
	return err
}

// List is every live employee in name order (last, then first name). The
// caller shows each as the reader may see it (Sight).
func (s *Service) List(ctx context.Context) ([]Employee, error) {
	return s.repo.List(ctx)
}

// Search is the employee search of the employee picker (Create Order's
// Assigned to, Orders' filter, Merge with…), ⌘K and Import Documents' person
// step: live employees whose first, last or full name or code contains q,
// case-insensitive, at most searchLimit. A blank query matches nothing.
func (s *Service) Search(ctx context.Context, q string) ([]Employee, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return make([]Employee, 0), nil
	}
	return s.repo.SearchByName(ctx, q, searchLimit)
}

// Update replaces every mutable field. A change to any size default records
// employee.sizes_changed; it never touches existing orders, which hold snapshots.
// It needs may.Profile; without may.Sizes the size defaults stay as they are,
// whatever p says (the writer may not even see them).
func (s *Service) Update(ctx context.Context, id uuid.UUID, p Params, may Rights, actor uuid.UUID) (Employee, error) {
	if actor == uuid.Nil {
		return Employee{}, fieldError("actor", "is required")
	}
	if !may.Profile {
		return Employee{}, ErrNotPermitted
	}
	if !may.Sizes {
		p.HeightCm, p.ClothingSize, p.ShoeSize = nil, nil, nil
	}
	if err := p.Validate(); err != nil {
		return Employee{}, err
	}
	e, err := s.repo.Update(ctx, id, func(cur Employee) (Employee, []audit.Event, error) {
		next := cur
		next.FirstName, next.LastName, next.Code, next.Notes = p.FirstName, p.LastName, p.Code, p.Notes
		next.PreferredLanguage = p.PreferredLanguage
		if may.Sizes {
			next.HeightCm, next.ClothingSize, next.ShoeSize = p.HeightCm, p.ClothingSize, p.ShoeSize
		}
		return s.touch(cur, next, actor)
	})
	if err != nil {
		return Employee{}, s.codeErr(ctx, err, p.Code, id)
	}
	return e, nil
}

// UpdateSizes is Edit Sizes and Save as Employee Default: it replaces only the
// three size defaults, recording employee.sizes_changed when one changes. The
// route requires employee_sizes.manage, so it takes no Rights.
func (s *Service) UpdateSizes(ctx context.Context, id uuid.UUID, p SizesParams, actor uuid.UUID) (Employee, error) {
	if actor == uuid.Nil {
		return Employee{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return Employee{}, err
	}
	return s.repo.Update(ctx, id, func(cur Employee) (Employee, []audit.Event, error) {
		next := cur
		next.HeightCm, next.ClothingSize, next.ShoeSize = p.HeightCm, p.ClothingSize, p.ShoeSize
		return s.touch(cur, next, actor)
	})
}

// touch stamps next and builds the events describing the change:
// employee.updated for the name, code, notes or language, and
// employee.sizes_changed for the size defaults.
func (s *Service) touch(cur, next Employee, actor uuid.UUID) (Employee, []audit.Event, error) {
	now := s.now()
	next.UpdatedAt, next.UpdatedByUserID = now, actor
	var evs []audit.Event
	if before, after := detailsChange(cur, next); len(after) > 0 {
		ev, err := s.event(actor, EventUpdated, cur.ID, now, before, after)
		if err != nil {
			return next, nil, err
		}
		evs = append(evs, *ev)
	}
	if before, after := snapshotOf(cur), snapshotOf(next); !before.equal(after) {
		ev, err := s.event(actor, EventSizesChanged, cur.ID, now, before, after)
		if err != nil {
			return next, nil, err
		}
		evs = append(evs, *ev)
	}
	return next, evs, nil
}

// Delete soft-deletes an employee. Their orders keep their snapshots. An
// employee who holds company assets is not deleted: leaving never returns
// them (assets brief §2), so they are returned or resolved first. The check
// runs under the employee's row lock, which giving an asset share-locks, so
// the two cannot pass each other.
func (s *Service) Delete(ctx context.Context, id uuid.UUID, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	_, err := s.repo.Update(ctx, id, func(cur Employee) (Employee, []audit.Event, error) {
		if s.holdings != nil {
			held, err := s.holdings.HeldBy(ctx, cur.ID)
			if err != nil {
				return cur, nil, err
			}
			if len(held) > 0 {
				return cur, nil, fmt.Errorf("%w: %s", ErrHoldsAssets, strings.Join(held, ", "))
			}
		}
		now := s.now()
		next := cur
		next.DeletedAt, next.DeletedByUserID = &now, &actor
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		ev, err := s.event(actor, EventDeleted, cur.ID, now, nil, nil)
		if err != nil {
			return next, nil, err
		}
		return next, []audit.Event{*ev}, nil
	})
	return err
}
