package company

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// fakeRepo mirrors the contract: live-only reads, set codes unique among live
// companies case-insensitively, one live default.
type fakeRepo struct {
	mu     sync.Mutex
	rows   map[uuid.UUID]Company
	events []audit.Event
}

func newFakeRepo() *fakeRepo { return &fakeRepo{rows: map[uuid.UUID]Company{}} }

func (f *fakeRepo) taken(c Company) error {
	for _, o := range f.rows {
		if o.ID == c.ID || o.Deleted() {
			continue
		}
		if c.Code != "" && strings.EqualFold(o.Code, c.Code) {
			return ErrCodeTaken
		}
		if c.IsDefault && o.IsDefault {
			return ErrDefaultTaken
		}
	}
	return nil
}

func (f *fakeRepo) Create(_ context.Context, c Company, ev audit.Event) (Company, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.taken(c); err != nil {
		return Company{}, err
	}
	f.rows[c.ID] = c
	f.events = append(f.events, ev)
	return c, nil
}

func (f *fakeRepo) Get(_ context.Context, id uuid.UUID) (Company, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.rows[id]
	if !ok || c.Deleted() {
		return Company{}, ErrNotFound
	}
	return c, nil
}

func (f *fakeRepo) Default(context.Context) (Company, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.rows {
		if c.IsDefault && !c.Deleted() {
			return c, nil
		}
	}
	return Company{}, ErrNotFound
}

func (f *fakeRepo) List(context.Context) ([]Company, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []Company{}
	for _, c := range f.rows {
		if !c.Deleted() {
			out = append(out, c)
		}
	}
	slices.SortFunc(out, func(a, b Company) int {
		if a.IsDefault != b.IsDefault {
			if a.IsDefault {
				return -1
			}
			return 1
		}
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
	return out, nil
}

func (f *fakeRepo) Update(_ context.Context, id uuid.UUID, m Mutation) (Company, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.rows[id]
	if !ok || cur.Deleted() {
		return Company{}, ErrNotFound
	}
	next, evs, err := m(cur)
	if err != nil {
		return Company{}, err
	}
	if len(evs) == 0 {
		return cur, nil
	}
	next.IsDefault = cur.IsDefault
	if err := f.taken(next); err != nil {
		return Company{}, err
	}
	f.rows[id] = next
	f.events = append(f.events, evs...)
	return next, nil
}

func (f *fakeRepo) MakeDefault(_ context.Context, id uuid.UUID, m func(Company, *Company) (Company, []audit.Event, error)) (Company, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.rows[id]
	if !ok || cur.Deleted() {
		return Company{}, ErrNotFound
	}
	var old *Company
	for _, c := range f.rows {
		if c.IsDefault && !c.Deleted() && c.ID != id {
			o := c
			old = &o
		}
	}
	next, evs, err := m(cur, old)
	if err != nil || len(evs) == 0 {
		return cur, err
	}
	if old != nil {
		o := f.rows[old.ID]
		o.IsDefault = false
		f.rows[old.ID] = o
	}
	f.rows[id] = next
	f.events = append(f.events, evs...)
	return next, nil
}

func names(evs []audit.Event) []string {
	out := make([]string, len(evs))
	for i, e := range evs {
		out[i] = e.Event
	}
	return out
}

func TestCreateFirstIsDefault(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	svc := NewService(repo)
	actor := uuid.New()
	a, err := svc.Create(ctx, Params{Name: "  UAB   Gavort ", VATCode: "lt 1000 0001", Country: "lt"}, actor)
	if err != nil || !a.IsDefault || a.Name != "UAB Gavort" || a.VATCode != "LT10000001" || a.Country != "LT" {
		t.Fatalf("first = %+v, %v", a, err)
	}
	var after map[string]any
	if err := json.Unmarshal(repo.events[0].After, &after); err != nil || after["is_default"] != true {
		t.Fatalf("first's event after = %s", repo.events[0].After)
	}
	b, err := svc.Create(ctx, Params{Name: "UAB Kitas"}, actor)
	if err != nil || b.IsDefault {
		t.Fatalf("second = %+v, %v", b, err)
	}
	// Companies without a code do not clash; a code is unique in any case.
	if _, err := svc.Create(ctx, Params{Name: "Trečia"}, actor); err != nil {
		t.Fatalf("a second without a code: %v", err)
	}
	if _, err := svc.Create(ctx, Params{Code: "GV", Name: "X"}, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctx, Params{Code: "gv", Name: "Y"}, actor); !errors.Is(err, ErrCodeTaken) {
		t.Fatalf("taken code: err = %v", err)
	}
	if d, err := svc.Default(ctx); err != nil || d.ID != a.ID {
		t.Fatalf("Default = %+v, %v", d, err)
	}
}

func TestCreateValidates(t *testing.T) {
	svc := NewService(newFakeRepo())
	for name, p := range map[string]Params{
		"no name":   {Name: "  "},
		"long name": {Name: strings.Repeat("a", maxNameLen+1)},
		"long code": {Name: "A", Code: strings.Repeat("a", maxCodeLen+1)},
		"country":   {Name: "A", Country: "LTU"},
		"notes":     {Name: "A", Notes: strings.Repeat("a", maxNotesLen+1)},
	} {
		if _, err := svc.Create(context.Background(), p, uuid.New()); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
	if _, err := svc.Create(context.Background(), Params{Name: "A"}, uuid.Nil); !errors.Is(err, ErrInvalid) {
		t.Errorf("no actor: err = %v", err)
	}
}

func TestUpdateRecordsChanges(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	svc := NewService(repo)
	actor := uuid.New()
	c, _ := svc.Create(ctx, Params{Name: "UAB Gavort", City: "Vilnius"}, actor)
	if _, err := svc.Update(ctx, c.ID, Params{Name: "UAB Gavort", City: "Vilnius"}, actor); err != nil || len(repo.events) != 1 {
		t.Fatalf("unchanged: %v, %d events", err, len(repo.events))
	}
	got, err := svc.Update(ctx, c.ID, Params{Name: "UAB Gavort", City: "Kaunas", Notes: "x"}, actor)
	if err != nil || got.City != "Kaunas" || !got.IsDefault {
		t.Fatalf("Update = %+v, %v", got, err)
	}
	ev := repo.events[1]
	if ev.Event != EventUpdated || string(ev.Before) != `{"city":"Vilnius"}` || string(ev.After) != `{"city":"Kaunas","notes_changed":true}` {
		t.Fatalf("event = %s %s %s", ev.Event, ev.Before, ev.After)
	}
	if _, err := svc.Update(ctx, uuid.New(), Params{Name: "A"}, actor); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown: err = %v", err)
	}
}

func TestMakeDefaultMovesIt(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	svc := NewService(repo)
	actor := uuid.New()
	a, _ := svc.Create(ctx, Params{Name: "A"}, actor)
	b, _ := svc.Create(ctx, Params{Name: "B"}, actor)
	got, err := svc.MakeDefault(ctx, b.ID, actor)
	if err != nil || !got.IsDefault {
		t.Fatalf("MakeDefault = %+v, %v", got, err)
	}
	if old, _ := svc.Get(ctx, a.ID); old.IsDefault {
		t.Fatal("the old default is still the default")
	}
	ev := repo.events[len(repo.events)-1]
	if ev.Event != EventMadeDefault || string(ev.Before) != `{"previous_default":"A"}` {
		t.Fatalf("event = %s %s", ev.Event, ev.Before)
	}
	n := len(repo.events)
	if _, err := svc.MakeDefault(ctx, b.ID, actor); err != nil || len(repo.events) != n {
		t.Fatalf("already the default: %v, %v", err, names(repo.events[n:]))
	}
	list, _ := svc.List(ctx)
	if len(list) != 2 || list[0].ID != b.ID {
		t.Fatalf("List = %+v, want the default first", list)
	}
}

func TestDeleteRefusals(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	svc := NewService(repo)
	actor := uuid.New()
	a, _ := svc.Create(ctx, Params{Name: "A", Code: "A1"}, actor)
	b, _ := svc.Create(ctx, Params{Name: "B"}, actor)
	if err := svc.Delete(ctx, a.ID, actor); !errors.Is(err, ErrIsDefault) {
		t.Fatalf("default: err = %v", err)
	}
	busy := repo.rows[b.ID]
	busy.EmployeeCount = 2
	repo.rows[b.ID] = busy
	if err := svc.Delete(ctx, b.ID, actor); !errors.Is(err, ErrInUse) {
		t.Fatalf("in use: err = %v", err)
	}
	busy.EmployeeCount = 0
	repo.rows[b.ID] = busy
	if err := svc.Delete(ctx, b.ID, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(ctx, b.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted still read: %v", err)
	}
	if got := names(repo.events); got[len(got)-1] != EventDeleted {
		t.Fatalf("events = %v", got)
	}
}

func TestCreateAfterARaceForTheDefault(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	svc := NewService(repo)
	// Another session's first company landed between Default and Create.
	other := Company{ID: uuid.New(), Name: "Other", IsDefault: true}
	racing := &racingRepo{fakeRepo: repo, other: other}
	svc.repo = racing
	c, err := svc.Create(ctx, Params{Name: "Mine"}, uuid.New())
	if err != nil || c.IsDefault {
		t.Fatalf("Create = %+v, %v; want added as not the default", c, err)
	}
}

// racingRepo adds other as the default just before the first Create.
type racingRepo struct {
	*fakeRepo
	other Company
	done  bool
}

func (r *racingRepo) Create(ctx context.Context, c Company, ev audit.Event) (Company, error) {
	if !r.done {
		r.done = true
		r.rows[r.other.ID] = r.other
	}
	return r.fakeRepo.Create(ctx, c, ev)
}
