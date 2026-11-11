package employee

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

func (f *fakeRepo) IDByCode(_ context.Context, code string) (uuid.UUID, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, e := range f.rows {
		if !e.Deleted() && e.Code != nil && strings.EqualFold(*e.Code, code) {
			return e.ID, true, nil
		}
	}
	return uuid.Nil, false, nil
}

func (f *fakeRepo) DistinctPairs(context.Context) (map[[2]uuid.UUID]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[[2]uuid.UUID]bool{}
	for k := range f.distinct {
		out[k] = true
	}
	return out, nil
}

func (f *fakeRepo) MarkDistinct(_ context.Context, a, b, _ uuid.UUID, _ time.Time, evs []audit.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, id := range []uuid.UUID{a, b} {
		if e, ok := f.rows[id]; !ok || e.Deleted() {
			return ErrNotFound
		}
	}
	if f.distinct[[2]uuid.UUID{a, b}] {
		return nil
	}
	f.distinct[[2]uuid.UUID{a, b}] = true
	f.events = append(f.events, evs...)
	return nil
}

func (f *fakeRepo) pair(keepID, removeID uuid.UUID) (Employee, Employee, error) {
	keep, ok1 := f.rows[keepID]
	remove, ok2 := f.rows[removeID]
	if !ok1 || !ok2 || keep.Deleted() || remove.Deleted() {
		return Employee{}, Employee{}, ErrNotFound
	}
	return keep, remove, nil
}

func (f *fakeRepo) MergeContents(_ context.Context, keepID, removeID uuid.UUID) (Employee, Employee, MergeContents, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	keep, remove, err := f.pair(keepID, removeID)
	return keep, remove, f.contents[removeID], err
}

func (f *fakeRepo) Merge(_ context.Context, keepID, removeID uuid.UUID, m MergeMutation) (Employee, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	keep, remove, err := f.pair(keepID, removeID)
	if err != nil {
		return Employee{}, err
	}
	next, evs, err := m(keep, remove, f.contents[removeID])
	if err != nil {
		return Employee{}, err
	}
	at := next.UpdatedAt
	remove.DeletedAt, remove.DeletedByUserID = &at, &next.UpdatedByUserID
	f.rows[removeID] = remove
	if f.codeTaken(next.Code, keepID) {
		return Employee{}, ErrCodeTaken
	}
	f.rows[keepID] = next
	f.mergedInto[removeID] = keepID
	f.events = append(f.events, evs...)
	return next, nil
}

func (f *fakeRepo) MergedInto(_ context.Context, id uuid.UUID) (uuid.UUID, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	into, ok := f.mergedInto[id]
	return into, ok, nil
}

func (f *fakeRepo) MergedFrom(_ context.Context, id uuid.UUID) ([]uuid.UUID, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]uuid.UUID, 0)
	for from, into := range f.mergedInto {
		if into == id {
			out = append(out, from)
		}
	}
	return out, nil
}

// productionPair adds the two records of one person found on production.
func productionPair(t *testing.T, svc *Service) (older, newer Employee) {
	t.Helper()
	ctx := context.Background()
	older, err := svc.Create(ctx, Params{FirstName: "Abhijith", LastName: "Palanil Sajeevan", HeightCm: ip(160),
		ClothingSize: ip(52), ShoeSize: sp("42"), Notes: "Night shift"}, everything, testActor)
	if err != nil {
		t.Fatal(err)
	}
	newer, err = svc.Create(ctx, Params{FirstName: "PALANJIL", LastName: "SAJEEVAN ABHIJITH", Code: sp("192"),
		HeightCm: ip(173), ClothingSize: ip(52), ShoeSize: sp("42")}, everything, testActor)
	if err != nil {
		t.Fatal(err)
	}
	return older, newer
}

func TestSimilar(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	older, _ := productionPair(t, svc)
	if _, err := svc.Create(ctx, Params{FirstName: "Sajeevan", LastName: "Abhijith Palanjil"}, everything, testActor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctx, Params{FirstName: "Jonas", LastName: "Petraitis"}, everything, testActor); err != nil {
		t.Fatal(err)
	}

	got, err := svc.Similar(ctx, "Palanjil", "Sajeevan Abhijith", uuid.Nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0].Kind != SameName || got[1].Kind != SameName || got[2].Kind != SimilarName {
		t.Fatalf("matches = %+v", got)
	}
	if got[2].Employee.ID != older.ID {
		t.Errorf("similar = %s, want the older record", got[2].Employee.FullName())
	}

	got, _ = svc.Similar(ctx, "Abhijith", "Palanil Sajeevan", older.ID)
	for _, m := range got {
		if m.Employee.ID == older.ID {
			t.Error("Similar returned the employee left out")
		}
	}
	if got, _ := svc.Similar(ctx, " ", "", uuid.Nil); len(got) != 0 {
		t.Errorf("blank name matched %d", len(got))
	}
}

func TestPossibleDuplicatesAndMarkDistinct(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	older, newer := productionPair(t, svc)
	if _, err := svc.Create(ctx, Params{FirstName: "Jonas", LastName: "Petraitis"}, everything, testActor); err != nil {
		t.Fatal(err)
	}
	pairs, err := svc.PossibleDuplicates(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(pairs) != 1 || pairs[0].Kind != SimilarName {
		t.Fatalf("pairs = %+v", pairs)
	}
	if ids := []uuid.UUID{pairs[0].A.ID, pairs[0].B.ID}; !(ids[0] == older.ID && ids[1] == newer.ID) && !(ids[0] == newer.ID && ids[1] == older.ID) {
		t.Errorf("pair = %v", ids)
	}

	if err := svc.MarkDistinct(ctx, newer.ID, older.ID, testActor); err != nil {
		t.Fatal(err)
	}
	if pairs, _ := svc.PossibleDuplicates(ctx); len(pairs) != 0 {
		t.Errorf("a pair marked Not the Same Person is still offered: %+v", pairs)
	}
	marked := 0
	for _, ev := range repo.events {
		if ev.Event == EventMarkedDistinct {
			marked++
		}
	}
	if marked != 2 {
		t.Errorf("marked_distinct events = %d, want one on each", marked)
	}
	// Again: nothing new.
	if err := svc.MarkDistinct(ctx, older.ID, newer.ID, testActor); err != nil {
		t.Fatal(err)
	}
	if n := len(repo.events); n != 5 { // 3 created + 2 marked
		t.Errorf("events = %d after marking again", n)
	}
	if err := svc.MarkDistinct(ctx, older.ID, older.ID, testActor); !errors.Is(err, ErrInvalid) {
		t.Errorf("same employee: err = %v", err)
	}
}

func TestMerge(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	keep, remove := productionPair(t, svc)
	order1, order2, assignment, photo := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	repo.contents[remove.ID] = MergeContents{Orders: []uuid.UUID{order1, order2}, Assignments: []uuid.UUID{assignment},
		OpenAssignments: 1, Photos: []uuid.UUID{photo}}
	repo.events = nil

	// The values chosen: the older record's name, the newer's code and height.
	chosen := Params{FirstName: "Abhijith", LastName: "Palanil Sajeevan", Code: sp("192"), HeightCm: ip(173),
		ClothingSize: ip(52), ShoeSize: sp("42"), Notes: "Night shift"}
	got, err := svc.Merge(ctx, keep.ID, remove.ID, chosen, everything, testActor)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != keep.ID || got.Code == nil || *got.Code != "192" || *got.HeightCm != 173 {
		t.Errorf("kept = %+v", got)
	}
	if _, err := svc.Get(ctx, remove.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("removed record: err = %v", err)
	} else {
		var merged *MergedError
		if !errors.As(err, &merged) || merged.Into != keep.ID {
			t.Errorf("removed record: err = %v, want MergedError into the kept one", err)
		}
	}
	if from, _ := svc.MergedIDs(ctx, keep.ID); len(from) != 1 || from[0] != remove.ID {
		t.Errorf("merged ids = %v", from)
	}

	byName := map[string][]audit.Event{}
	for _, ev := range repo.events {
		byName[ev.Event] = append(byName[ev.Event], ev)
	}
	if len(byName[EventMerged]) != 1 || byName[EventMerged][0].EntityID != keep.ID {
		t.Fatalf("merged events = %+v", byName[EventMerged])
	}
	var after map[string]any
	if err := json.Unmarshal(byName[EventMerged][0].After, &after); err != nil {
		t.Fatal(err)
	}
	if after["merged_employee_id"] != remove.ID.String() || after["code"] != "192" || after["height_cm"] != float64(173) {
		t.Errorf("merged after = %v", after)
	}
	if _, ok := after["notes_changed"]; ok {
		t.Error("notes unchanged, yet recorded as changed")
	}
	if len(byName[EventMergedAway]) != 1 || byName[EventMergedAway][0].EntityID != remove.ID {
		t.Errorf("merged_away = %+v", byName[EventMergedAway])
	}
	if moved := byName[EventOrderMoved]; len(moved) != 2 || moved[0].EntityType != "order" || moved[0].EntityID != order1 {
		t.Errorf("order events = %+v", moved)
	}
}

func TestMergeRefusals(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	keep, remove := productionPair(t, svc)
	p := Params{FirstName: "Abhijith", LastName: "Palanil Sajeevan"}

	if _, err := svc.Merge(ctx, keep.ID, keep.ID, p, everything, testActor); !errors.Is(err, ErrInvalid) {
		t.Errorf("same record: err = %v", err)
	}
	if _, err := svc.Merge(ctx, keep.ID, remove.ID, Params{FirstName: "A"}, everything, testActor); !errors.Is(err, ErrInvalid) {
		t.Errorf("no last name: err = %v", err)
	}
	if _, err := svc.Merge(ctx, keep.ID, uuid.New(), p, everything, testActor); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown record: err = %v", err)
	}
	repo.contents[remove.ID] = MergeContents{RemoveHasDocuments: true}
	if _, err := svc.Merge(ctx, keep.ID, remove.ID, p, everything, testActor); !errors.Is(err, ErrMergePersonnel) {
		t.Errorf("removed record with identity documents: err = %v", err)
	}
	if _, err := svc.Get(ctx, remove.ID); err != nil {
		t.Errorf("a refused merge removed the record: %v", err)
	}
}

func TestMergeWithoutSizeRightsKeepsSizes(t *testing.T) {
	svc, _ := newTestService()
	keep, remove := productionPair(t, svc)
	got, err := svc.Merge(context.Background(), keep.ID, remove.ID,
		Params{FirstName: "Abhijith", LastName: "Palanil Sajeevan", HeightCm: ip(173)}, Rights{Profile: true}, testActor)
	if err != nil {
		t.Fatal(err)
	}
	if got.HeightCm == nil || *got.HeightCm != 160 {
		t.Errorf("height = %v, want the kept record's 160", got.HeightCm)
	}
}

func TestCodeTakenNamesTheEmployee(t *testing.T) {
	svc, _ := newTestService()
	_, newer := productionPair(t, svc)
	_, err := svc.Create(context.Background(), Params{FirstName: "Other", LastName: "Person", Code: sp("192")}, everything, testActor)
	var taken *CodeTakenError
	if !errors.Is(err, ErrCodeTaken) || !errors.As(err, &taken) || taken.Existing != newer.ID {
		t.Errorf("err = %v, want CodeTakenError naming the employee with 192", err)
	}
}
