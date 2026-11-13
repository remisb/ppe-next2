package employee

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Events of Duplicates and merging (docs/specs/employee-service.md).
// EventOrderMoved is written on each order the removed record had, as the
// order's own: whose order it is changed, not what was ordered.
const (
	EventMerged         = "employee.merged"
	EventMergedAway     = "employee.merged_away"
	EventMarkedDistinct = "employee.marked_distinct"
	EventOrderMoved     = "order.employee_merged"
	orderEntity         = "order"
	similarLimit        = 5
)

var (
	// ErrMergePersonnel refuses removing a record that has identity
	// documents: their data key is sealed to that record (ADR 0007), so it is
	// the one kept.
	ErrMergePersonnel = errors.New("the employee removed has identity documents; keep that record instead")
)

// MergedError is a read of a record merged into another, which it names, so
// the app can open that one instead. It is still ErrNotFound.
type MergedError struct{ Into uuid.UUID }

// Error is ErrNotFound's message, saying the record was merged.
func (e *MergedError) Error() string { return ErrNotFound.Error() + ": merged into another record" }

// Unwrap makes errors.Is(err, ErrNotFound) hold.
func (e *MergedError) Unwrap() error { return ErrNotFound }

// ExistingID is the record kept, which the API answers as existing_id.
func (e *MergedError) ExistingID() uuid.UUID { return e.Into }

// CodeTakenError is a code another live employee has, which it names, so
// the app can offer that employee instead. It is still ErrCodeTaken.
type CodeTakenError struct{ Existing uuid.UUID }

// Error is ErrCodeTaken's message.
func (e *CodeTakenError) Error() string { return ErrCodeTaken.Error() }

// Unwrap makes errors.Is(err, ErrCodeTaken) hold.
func (e *CodeTakenError) Unwrap() error { return ErrCodeTaken }

// ExistingID is the employee who has the code, which the API answers as existing_id.
func (e *CodeTakenError) ExistingID() uuid.UUID { return e.Existing }

// MergeContents is what the record removed has that moves to the one kept,
// and whether either has identity documents.
type MergeContents struct {
	Orders             []uuid.UUID `json:"orders"`
	Assignments        []uuid.UUID `json:"assignments"`
	OpenAssignments    int         `json:"open_assignments"`
	Photos             []uuid.UUID `json:"photos"`
	KeepHasDocuments   bool        `json:"keep_has_documents"`
	RemoveHasDocuments bool        `json:"remove_has_documents"`
}

// MergeMutation computes the record kept, and the events, from both locked
// records and what the removed one has. A returned error aborts the merge.
type MergeMutation func(keep, remove Employee, c MergeContents) (Employee, []audit.Event, error)

// MergePreview is Merge Employees' review: both records and what would move.
type MergePreview struct {
	Keep     Employee      `json:"keep"`
	Remove   Employee      `json:"remove"`
	Contents MergeContents `json:"contents"`
}

// Similar lists live employees whose names are like first and last
// (CompareNames), the same names first, at most similarLimit, leaving out
// except. Add New Employee asks it before adding; Merge with… asks it for the
// employee being merged, as except, to offer alike names first.
func (s *Service) Similar(ctx context.Context, first, last string, except uuid.UUID) ([]Match, error) {
	first, last = strings.TrimSpace(first), strings.TrimSpace(last)
	out := make([]Match, 0)
	if first == "" && last == "" {
		return out, nil
	}
	words := nameWords(first, last)
	es, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	for _, e := range es {
		if e.ID == except {
			continue
		}
		if kind, ok := compareWords(words, nameWords(e.FirstName, e.LastName)); ok {
			out = append(out, Match{Employee: e, Kind: kind})
		}
	}
	// List is in name order; the same names go first.
	slices.SortStableFunc(out, func(a, b Match) int { return kindRank(a.Kind) - kindRank(b.Kind) })
	if len(out) > similarLimit {
		out = out[:similarLimit]
	}
	return out, nil
}

// kindRank orders matches: SameName before SimilarName.
func kindRank(k MatchKind) int {
	if k == SameName {
		return 0
	}
	return 1
}

// PossibleDuplicates is every pair of live employees whose names are alike,
// except those marked Not the Same Person, the older record first. It
// compares every pair in Go: no index serves alike names.
func (s *Service) PossibleDuplicates(ctx context.Context) ([]Pair, error) {
	es, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	distinct, err := s.repo.DistinctPairs(ctx)
	if err != nil {
		return nil, err
	}
	words := make([][]string, len(es))
	for i, e := range es {
		words[i] = nameWords(e.FirstName, e.LastName)
	}
	out := make([]Pair, 0)
	for i := range es {
		for j := i + 1; j < len(es); j++ {
			kind, ok := compareWords(words[i], words[j])
			if !ok || distinct[pairKey(es[i].ID, es[j].ID)] {
				continue
			}
			a, b := es[i], es[j]
			if b.CreatedAt.Before(a.CreatedAt) {
				a, b = b, a
			}
			out = append(out, Pair{A: a, B: b, Kind: kind})
		}
	}
	return out, nil
}

// pairKey is a pair of employees in the order employee_distinct_pairs keeps them.
func pairKey(a, b uuid.UUID) [2]uuid.UUID {
	if strings.Compare(a.String(), b.String()) > 0 {
		a, b = b, a
	}
	return [2]uuid.UUID{a, b}
}

// MarkDistinct is Not the Same Person: a and b stop being offered as
// possible duplicates. Marking a pair again changes nothing.
func (s *Service) MarkDistinct(ctx context.Context, a, b uuid.UUID, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	if a == b {
		return fieldError("employee_b", "is the same employee")
	}
	ea, err := s.repo.Get(ctx, a)
	if err != nil {
		return err
	}
	eb, err := s.repo.Get(ctx, b)
	if err != nil {
		return err
	}
	now := s.now()
	var evs []audit.Event
	for _, pair := range [][2]Employee{{ea, eb}, {eb, ea}} {
		ev, err := s.event(actor, EventMarkedDistinct, pair[0].ID, now, nil,
			map[string]any{"other_employee_id": pair[1].ID, "other_employee_name": pair[1].FullName()})
		if err != nil {
			return err
		}
		evs = append(evs, *ev)
	}
	key := pairKey(a, b)
	return s.repo.MarkDistinct(ctx, key[0], key[1], actor, now, evs)
}

// MergePreview is what merging remove into keep would move, read without
// locks for the review; Merge reads it again under them.
func (s *Service) MergePreview(ctx context.Context, keepID, removeID uuid.UUID) (MergePreview, error) {
	if keepID == removeID {
		return MergePreview{}, fieldError("remove", "is the employee kept")
	}
	keep, remove, c, err := s.repo.MergeContents(ctx, keepID, removeID)
	if err != nil {
		return MergePreview{}, err
	}
	return MergePreview{Keep: keep, Remove: remove, Contents: c}, nil
}

// Merge is Merge Employees: one person's two records made one. The record
// kept takes p (the values chosen on the review, as Update takes them); the
// removed one's orders, company assets (its assignments, open or returned)
// and photos move to it, and it is removed, pointing at the one kept. Orders'
// and signed forms' snapshots keep the name they were made with. A removed
// record with identity documents is refused (ErrMergePersonnel). The route's
// employees.merge needs employee_profiles.manage and employee_sizes.manage
// (role catalogue), so may is normally both; should may.Sizes be false, the
// record kept keeps its own sizes.
func (s *Service) Merge(ctx context.Context, keepID, removeID uuid.UUID, p Params, may Rights, actor uuid.UUID) (Employee, error) {
	if actor == uuid.Nil {
		return Employee{}, fieldError("actor", "is required")
	}
	if keepID == removeID {
		return Employee{}, fieldError("remove", "is the employee kept")
	}
	if !may.Sizes {
		p.HeightCm, p.ClothingSize, p.ShoeSize = nil, nil, nil
	}
	if err := p.Validate(); err != nil {
		return Employee{}, err
	}
	return s.repo.Merge(ctx, keepID, removeID, func(keep, remove Employee, c MergeContents) (Employee, []audit.Event, error) {
		if c.RemoveHasDocuments {
			return keep, nil, ErrMergePersonnel
		}
		next := keep
		next.FirstName, next.LastName, next.Code, next.Notes = p.FirstName, p.LastName, p.Code, p.Notes
		next.PreferredLanguage = p.PreferredLanguage
		if may.Sizes {
			next.HeightCm, next.ClothingSize, next.ShoeSize = p.HeightCm, p.ClothingSize, p.ShoeSize
		}
		now := s.now()
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		evs, err := s.mergeEvents(keep, next, remove, c, actor, now)
		return next, evs, err
	})
}

// mergeEvents: employee.merged on the record kept (its changed fields as
// employee.updated and employee.sizes_changed record them, the record merged
// in and what moved), employee.merged_away on the one removed, and
// order.employee_merged on each order that moved.
func (s *Service) mergeEvents(keep, next, remove Employee, c MergeContents, actor uuid.UUID, at time.Time) ([]audit.Event, error) {
	before, after := detailsChange(keep, next)
	if b, a := snapshotOf(keep), snapshotOf(next); !b.equal(a) {
		before["height_cm"], before["clothing_size"], before["shoe_size"] = b.HeightCm, b.ClothingSize, b.ShoeSize
		after["height_cm"], after["clothing_size"], after["shoe_size"] = a.HeightCm, a.ClothingSize, a.ShoeSize
	}
	after["merged_employee_id"] = remove.ID
	after["merged_employee_name"] = remove.FullName()
	after["orders"], after["assignments"], after["photos"] = c.Orders, c.Assignments, c.Photos
	var evs []audit.Event
	add := func(name, entity string, id uuid.UUID, before, after any) error {
		ev, err := audit.New(s.newID(), &actor, name, entity, id, at, before, after)
		if err != nil {
			return err
		}
		evs = append(evs, ev)
		return nil
	}
	if err := add(EventMerged, auditEntity, keep.ID, before, after); err != nil {
		return nil, err
	}
	if err := add(EventMergedAway, auditEntity, remove.ID, nil, map[string]any{
		"merged_into_id": keep.ID, "merged_into_name": next.FullName(),
	}); err != nil {
		return nil, err
	}
	for _, o := range c.Orders {
		if err := add(EventOrderMoved, orderEntity, o, map[string]any{"employee_id": remove.ID},
			map[string]any{"employee_id": keep.ID}); err != nil {
			return nil, err
		}
	}
	return evs, nil
}

// mergedErr is ErrNotFound for id, or a MergedError when id was merged into
// another record.
func (s *Service) mergedErr(ctx context.Context, id uuid.UUID, err error) error {
	if !errors.Is(err, ErrNotFound) {
		return err
	}
	into, ok, lookErr := s.repo.MergedInto(ctx, id)
	if lookErr != nil {
		return fmt.Errorf("%w (%v)", err, lookErr)
	}
	if !ok {
		return err
	}
	return &MergedError{Into: into}
}

// MergedIDs are the records merged into id, whose Changes are id's too.
func (s *Service) MergedIDs(ctx context.Context, id uuid.UUID) ([]uuid.UUID, error) {
	return s.repo.MergedFrom(ctx, id)
}
