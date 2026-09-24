package employee

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// fakeRepo mirrors the Postgres contract: live-only reads, code unique among
// live rows (case-insensitive), mutations applied to the current row, and
// events kept only when the write succeeds.
type fakeRepo struct {
	mu     sync.Mutex
	rows   map[uuid.UUID]Employee
	events []audit.Event
}

func newFakeRepo() *fakeRepo { return &fakeRepo{rows: map[uuid.UUID]Employee{}} }

func (f *fakeRepo) codeTaken(code *string, except uuid.UUID) bool {
	if code == nil {
		return false
	}
	for _, e := range f.rows {
		if e.ID != except && !e.Deleted() && e.Code != nil && strings.EqualFold(*e.Code, *code) {
			return true
		}
	}
	return false
}

func (f *fakeRepo) record(ev *audit.Event) {
	if ev != nil {
		f.events = append(f.events, *ev)
	}
}

func (f *fakeRepo) Create(_ context.Context, e Employee, ev *audit.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.codeTaken(e.Code, e.ID) {
		return ErrCodeTaken
	}
	f.rows[e.ID] = e
	f.record(ev)
	return nil
}

func (f *fakeRepo) Get(_ context.Context, id uuid.UUID) (Employee, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	e, ok := f.rows[id]
	if !ok || e.Deleted() {
		return Employee{}, ErrNotFound
	}
	return e, nil
}

func (f *fakeRepo) List(_ context.Context) ([]Employee, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Employee, 0)
	for _, e := range f.rows {
		if !e.Deleted() {
			out = append(out, e)
		}
	}
	return out, nil
}

func (f *fakeRepo) SearchByName(_ context.Context, q string, limit int) ([]Employee, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	q = strings.ToLower(q)
	out := make([]Employee, 0)
	for _, e := range f.rows {
		code := ""
		if e.Code != nil {
			code = *e.Code
		}
		hay := strings.ToLower(e.FullName() + "|" + code)
		if !e.Deleted() && strings.Contains(hay, q) && len(out) < limit {
			out = append(out, e)
		}
	}
	return out, nil
}

func (f *fakeRepo) Update(_ context.Context, id uuid.UUID, m Mutation) (Employee, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.rows[id]
	if !ok || cur.Deleted() {
		return Employee{}, ErrNotFound
	}
	next, ev, err := m(cur)
	if err != nil {
		return Employee{}, err
	}
	if f.codeTaken(next.Code, id) {
		return Employee{}, ErrCodeTaken
	}
	f.rows[id] = next
	f.record(ev)
	return next, nil
}

var (
	testNow   = time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	testActor = uuid.New()
)

func sp2(s string) *string { return &s }

func newTestService() (*Service, *fakeRepo) {
	repo := newFakeRepo()
	return NewService(repo, WithClock(func() time.Time { return testNow })), repo
}

func TestCreateRecordsEvent(t *testing.T) {
	svc, repo := newTestService()
	e, err := svc.Create(context.Background(), Params{FirstName: "Jonas", LastName: "Petraitis", ShoeSize: sp2("43")}, testActor)
	if err != nil {
		t.Fatal(err)
	}
	if e.CreatedByUserID != testActor || !e.CreatedAt.Equal(testNow) {
		t.Errorf("employee = %+v", e)
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventCreated || repo.events[0].EntityID != e.ID {
		t.Fatalf("events = %+v", repo.events)
	}
	if !strings.Contains(string(repo.events[0].After), `"shoe_size":"43"`) {
		t.Errorf("after = %s", repo.events[0].After)
	}
}

func TestCreateErrors(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	if _, err := svc.Create(ctx, Params{FirstName: "A", LastName: "B"}, uuid.Nil); !errors.Is(err, ErrInvalid) {
		t.Errorf("nil actor err = %v", err)
	}
	if _, err := svc.Create(ctx, Params{FirstName: "A"}, testActor); !errors.Is(err, ErrInvalid) {
		t.Errorf("missing last name err = %v", err)
	}
	if _, err := svc.Create(ctx, Params{FirstName: "A", LastName: "B", Code: sp2("E-1")}, testActor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctx, Params{FirstName: "C", LastName: "D", Code: sp2("e-1")}, testActor); !errors.Is(err, ErrCodeTaken) {
		t.Errorf("duplicate code err = %v", err)
	}
}

func TestSizeChangesAudited(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	e, _ := svc.Create(ctx, Params{FirstName: "A", LastName: "B"}, testActor)
	repo.events = nil

	// Renaming without touching sizes records nothing.
	if _, err := svc.Update(ctx, e.ID, Params{FirstName: "A2", LastName: "B"}, testActor); err != nil {
		t.Fatal(err)
	}
	if len(repo.events) != 0 {
		t.Fatalf("rename recorded %d events", len(repo.events))
	}

	got, err := svc.UpdateSizes(ctx, e.ID, SizesParams{ClothingSize: sp2("l"), ShoeSize: sp2("44")}, testActor)
	if err != nil {
		t.Fatal(err)
	}
	if *got.ClothingSize != "L" || got.FirstName != "A2" {
		t.Errorf("after sizes = %+v", got)
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventSizesChanged {
		t.Fatalf("events = %+v", repo.events)
	}
	if !strings.Contains(string(repo.events[0].Before), `"clothing_size":null`) ||
		!strings.Contains(string(repo.events[0].After), `"clothing_size":"L"`) {
		t.Errorf("before %s after %s", repo.events[0].Before, repo.events[0].After)
	}

	// Same sizes again: no event.
	if _, err := svc.UpdateSizes(ctx, e.ID, SizesParams{ClothingSize: sp2("L"), ShoeSize: sp2("44")}, testActor); err != nil {
		t.Fatal(err)
	}
	if len(repo.events) != 1 {
		t.Errorf("unchanged sizes recorded an event")
	}
	if _, err := svc.UpdateSizes(ctx, e.ID, SizesParams{ShoeSize: sp2("38")}, testActor); !errors.Is(err, ErrInvalid) {
		t.Errorf("bad shoe size err = %v", err)
	}
	if _, err := svc.UpdateSizes(ctx, uuid.New(), SizesParams{}, testActor); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown employee err = %v", err)
	}
}

func TestSearch(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	svc.Create(ctx, Params{FirstName: "Jonas", LastName: "Petraitis", Code: sp2("W-17")}, testActor)
	svc.Create(ctx, Params{FirstName: "Ona", LastName: "Kazlauskienė"}, testActor)

	for q, want := range map[string]int{"jon": 1, "ONA": 2, "w-17": 1, "jonas pet": 1, "  ": 0, "zzz": 0} {
		got, err := svc.Search(ctx, q)
		if err != nil || len(got) != want {
			t.Errorf("Search(%q) = %d results, %v; want %d", q, len(got), err, want)
		}
	}
}

func TestDeleteIsSoft(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	e, _ := svc.Create(ctx, Params{FirstName: "A", LastName: "B", Code: sp2("X")}, testActor)
	if err := svc.Delete(ctx, e.ID, testActor); err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete(ctx, e.ID, testActor); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete err = %v", err)
	}
	if _, err := svc.Get(ctx, e.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("get deleted err = %v", err)
	}
	if repo.rows[e.ID].DeletedByUserID == nil || repo.events[len(repo.events)-1].Event != EventDeleted {
		t.Errorf("delete not recorded: %+v", repo.rows[e.ID])
	}
	if _, err := svc.Create(ctx, Params{FirstName: "C", LastName: "D", Code: sp2("x")}, testActor); err != nil {
		t.Errorf("code reuse after delete: %v", err)
	}
}
