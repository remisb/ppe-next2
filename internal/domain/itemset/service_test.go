package itemset

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
)

type fakeRepo struct {
	mu   sync.Mutex
	rows map[uuid.UUID]ItemSet
}

func newFakeRepo() *fakeRepo { return &fakeRepo{rows: map[uuid.UUID]ItemSet{}} }

func (f *fakeRepo) nameTaken(name string, except uuid.UUID) bool {
	for _, s := range f.rows {
		if s.ID != except && !s.Deleted() && strings.EqualFold(s.Name, name) {
			return true
		}
	}
	return false
}

func (f *fakeRepo) Create(_ context.Context, s ItemSet) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.nameTaken(s.Name, s.ID) {
		return ErrNameTaken
	}
	f.rows[s.ID] = s
	return nil
}

func (f *fakeRepo) Get(_ context.Context, id uuid.UUID) (ItemSet, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.rows[id]
	if !ok || s.Deleted() {
		return ItemSet{}, ErrNotFound
	}
	return s, nil
}

func (f *fakeRepo) list(activeOnly bool) []ItemSet {
	out := make([]ItemSet, 0)
	for _, s := range f.rows {
		if !s.Deleted() && (!activeOnly || s.Active) {
			out = append(out, s)
		}
	}
	slices.SortFunc(out, func(a, b ItemSet) int { return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)) })
	return out
}

func (f *fakeRepo) List(context.Context) ([]ItemSet, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.list(false), nil
}

func (f *fakeRepo) ListActive(context.Context) ([]ItemSet, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.list(true), nil
}

func (f *fakeRepo) Update(_ context.Context, s ItemSet) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if cur, ok := f.rows[s.ID]; !ok || cur.Deleted() {
		return ErrNotFound
	}
	if f.nameTaken(s.Name, s.ID) {
		return ErrNameTaken
	}
	f.rows[s.ID] = s
	return nil
}

func (f *fakeRepo) Delete(_ context.Context, s ItemSet) error {
	return f.Update(context.Background(), s)
}

// knownItems is a CatalogueChecker over a fixed set of live ids.
type knownItems map[uuid.UUID]bool

func (k knownItems) MissingItems(_ context.Context, ids []uuid.UUID) ([]uuid.UUID, error) {
	var missing []uuid.UUID
	for _, id := range ids {
		if !k[id] {
			missing = append(missing, id)
		}
	}
	return missing, nil
}

var testActor = uuid.New()

func TestCreateUpdateDelete(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	svc := NewService(newFakeRepo(), knownItems{a: true, b: true, c: true})
	ctx := context.Background()

	set, err := svc.Create(ctx, Params{Name: "Warehouse", Active: true, Lines: []LineParams{{b, 2}, {a, 1}}}, testActor)
	if err != nil {
		t.Fatal(err)
	}
	if set.Lines[0].CatalogueItemID != b || set.Lines[0].DisplayOrder != 0 || set.Lines[1].DisplayOrder != 1 {
		t.Errorf("lines = %+v", set.Lines)
	}
	if _, err := svc.Create(ctx, Params{Name: "warehouse", Lines: []LineParams{{a, 1}}}, testActor); !errors.Is(err, ErrNameTaken) {
		t.Errorf("duplicate err = %v", err)
	}
	if _, err := svc.Create(ctx, Params{Name: "Other", Lines: []LineParams{{uuid.New(), 1}}}, testActor); !errors.Is(err, ErrUnknownItem) {
		t.Errorf("unknown item err = %v", err)
	}

	upd, err := svc.Update(ctx, set.ID, Params{Name: "Warehouse", Active: false, Lines: []LineParams{{c, 5}}}, testActor)
	if err != nil {
		t.Fatal(err)
	}
	if len(upd.Lines) != 1 || upd.Lines[0].CatalogueItemID != c || upd.Active {
		t.Errorf("updated = %+v", upd)
	}
	active, _ := svc.ListActive(ctx)
	if len(active) != 0 {
		t.Errorf("inactive set listed as active")
	}
	if err := svc.Delete(ctx, set.ID, testActor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(ctx, set.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("get deleted err = %v", err)
	}
	if err := svc.Delete(ctx, set.ID, testActor); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete err = %v", err)
	}
}
