package document

import (
	"context"
	"slices"
	"testing"

	"github.com/google/uuid"
)

// fakePeople answers Match's questions about employees.
type fakePeople struct {
	alike   []AlikePerson
	persons map[uuid.UUID]Person
	pairs   []MatchPair
	asked   [][2]string
	holds   map[uuid.UUID][2]int
}

func (f *fakePeople) Alike(_ context.Context, first, last string) ([]AlikePerson, error) {
	f.asked = append(f.asked, [2]string{first, last})
	return f.alike, nil
}

func (f *fakePeople) Person(_ context.Context, id uuid.UUID) (Person, bool, error) {
	p, ok := f.persons[id]
	return p, ok, nil
}

func (f *fakePeople) Holds(_ context.Context, id uuid.UUID) (int, int, error) {
	h := f.holds[id]
	return h[0], h[1], nil
}

func (f *fakePeople) Pairs(_ context.Context, ids []uuid.UUID) ([]MatchPair, error) {
	var out []MatchPair
	for _, p := range f.pairs {
		if slices.Contains(ids, p.A) && slices.Contains(ids, p.B) {
			out = append(out, p)
		}
	}
	return out, nil
}

func matchService(t *testing.T, people *fakePeople) (*Service, *fakeRepo, *fakeStore) {
	t.Helper()
	svc, repo, store := newTestService(t)
	WithPeople(people)(svc)
	return svc, repo, store
}

func TestMatchOffersAlikeNamesWithWhatTheyHold(t *testing.T) {
	a := Person{ID: uuid.New(), FullName: "Jonas Pavyzdys", Code: ptr("1042"), BirthDate: ptr("1933-09-24")}
	b := Person{ID: uuid.New(), FullName: "Jonas Pavyzdis"}
	people := &fakePeople{
		alike: []AlikePerson{{a, MatchSameName}, {b, MatchSimilarName}},
		holds: map[uuid.UUID][2]int{a.ID: {6, 1}},
		pairs: []MatchPair{{A: a.ID, B: b.ID, Kind: MatchSimilarName}},
	}
	svc, repo, _ := matchService(t, people)
	got, err := svc.Match(context.Background(), MatchParams{MRZ: td3(jonas), Surname: "Pavyzdys", GivenNames: "Jonas"})
	if err != nil {
		t.Fatal(err)
	}
	if !got.Check.Valid || len(got.Candidates) != 2 {
		t.Fatalf("check valid %v, %d candidates", got.Check.Valid, len(got.Candidates))
	}
	first := got.Candidates[0]
	if first.Employee.ID != a.ID || first.Kind != MatchSameName || first.Orders != 6 || first.Assets != 1 ||
		*first.Employee.Code != "1042" || *first.BirthDate != "1933-09-24" || first.HasDocuments {
		t.Errorf("first candidate %+v", first)
	}
	if got.Candidates[1].Employee.ID != b.ID || got.Candidates[1].Kind != MatchSimilarName {
		t.Errorf("second candidate %+v", got.Candidates[1])
	}
	if len(got.Pairs) != 1 || got.Pairs[0].A != a.ID {
		t.Errorf("pairs %+v", got.Pairs)
	}
	if !slices.Equal(people.asked, [][2]string{{"Jonas", "Pavyzdys"}}) {
		t.Errorf("asked about %v", people.asked)
	}
	if len(repo.events) != 0 {
		t.Error("Match wrote events")
	}
}

func TestMatchPutsThePersonalCodesHolderFirstAndOnce(t *testing.T) {
	svc, _, _ := matchService(t, &fakePeople{})
	doc := savedPassport(t, svc)
	holder := Person{ID: doc.EmployeeID, FullName: "Jonas Pavyzdys"}
	stranger := Person{ID: uuid.New(), FullName: "Jonas Pavyzdys"}
	people := &fakePeople{alike: []AlikePerson{{stranger, MatchSameName}, {holder, MatchSameName}},
		persons: map[uuid.UUID]Person{holder.ID: holder}}
	WithPeople(people)(svc)
	got, err := svc.Match(context.Background(), MatchParams{MRZ: td3(jonas)})
	if err != nil {
		t.Fatal(err)
	}
	var kinds []string
	for _, c := range got.Candidates {
		kinds = append(kinds, c.Kind)
	}
	if len(got.Candidates) != 2 || got.Candidates[0].Employee.ID != holder.ID || !slices.Equal(kinds, []string{MatchPersonalCode, MatchSameName}) {
		t.Fatalf("candidates %+v", got.Candidates)
	}
	if !got.Candidates[0].HasDocuments || got.Candidates[1].HasDocuments {
		t.Error("has_documents is the holder's alone")
	}
	// No names given: the MRZ's are asked about.
	if !slices.Equal(people.asked, [][2]string{{"JONAS", "PAVYZDYS"}}) {
		t.Errorf("asked about %v", people.asked)
	}
}

func TestMatchOffersNoOneForAReadingThatDoesNotPass(t *testing.T) {
	people := &fakePeople{alike: []AlikePerson{{Person{ID: uuid.New()}, MatchSameName}}}
	svc, _, _ := matchService(t, people)
	lines := td3(jonas)
	lines[1] = lines[1][:9] + "0" + lines[1][10:]
	got, err := svc.Match(context.Background(), MatchParams{MRZ: lines})
	if err != nil {
		t.Fatal(err)
	}
	if got.Check.Valid || len(got.Candidates) != 0 || len(people.asked) != 0 {
		t.Errorf("valid %v, %d candidates, asked %v", got.Check.Valid, len(got.Candidates), people.asked)
	}
}

func TestMatchOffersAtMostFive(t *testing.T) {
	people := &fakePeople{}
	for range 7 {
		people.alike = append(people.alike, AlikePerson{Person{ID: uuid.New()}, MatchSimilarName})
	}
	svc, _, _ := matchService(t, people)
	got, err := svc.Match(context.Background(), MatchParams{MRZ: td3(jonas)})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Candidates) != maxCandidates {
		t.Errorf("%d candidates", len(got.Candidates))
	}
}

func TestMatchSkipsAHolderNoLongerOnFile(t *testing.T) {
	svc, _, _ := matchService(t, &fakePeople{})
	savedPassport(t, svc)
	got, err := svc.Match(context.Background(), MatchParams{MRZ: td3(jonas)})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Candidates) != 0 {
		t.Errorf("a holder People no longer has is offered: %+v", got.Candidates)
	}
}
