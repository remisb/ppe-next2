package asset

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/jpeg"
	"io"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/files"
)

// fakeRepo mirrors the Postgres contract: live-only reads, inventory numbers
// never reused (case-insensitive), SIM numbers unique among live assets
// without spaces, at most one open assignment per asset, and events kept
// only when the write succeeds.
type fakeRepo struct {
	mu          sync.Mutex
	assets      map[uuid.UUID]Asset
	numbers     map[string]uuid.UUID // upper-cased number → asset
	counters    map[string]int64
	assignments []Assignment
	employees   map[uuid.UUID]EmployeeView
	copies      []SignedCopy
	events      []audit.Event
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{assets: map[uuid.UUID]Asset{}, numbers: map[string]uuid.UUID{}, counters: map[string]int64{}, employees: map[uuid.UUID]EmployeeView{}}
}

func (f *fakeRepo) simTaken(a Asset) bool {
	if a.SimNo == nil {
		return false
	}
	for _, x := range f.assets {
		if x.ID != a.ID && !x.Deleted() && x.SimNo != nil && compactSIM(*x.SimNo) == compactSIM(*a.SimNo) {
			return true
		}
	}
	return false
}

func (f *fakeRepo) useNumber(id uuid.UUID, number string) error {
	if owner, ok := f.numbers[strings.ToUpper(number)]; ok && owner != id {
		return ErrInventoryNoTaken
	}
	f.numbers[strings.ToUpper(number)] = id
	return nil
}

func (f *fakeRepo) open(assetID uuid.UUID) *Assignment {
	for i := range f.assignments {
		if a := f.assignments[i]; a.AssetID == assetID && a.Open() {
			a.EmployeeName = f.employees[a.EmployeeID].FullName()
			return &a
		}
	}
	return nil
}

func (f *fakeRepo) Record(_ context.Context, ev audit.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, ev)
	return nil
}

func (f *fakeRepo) Create(_ context.Context, a Asset, bump *Bump, ev audit.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.simTaken(a) {
		return ErrSIMNoTaken
	}
	if err := f.useNumber(a.ID, a.InventoryNo); err != nil {
		return err
	}
	if bump != nil && bump.N > f.counters[bump.Prefix] {
		f.counters[bump.Prefix] = bump.N
	}
	f.assets[a.ID] = a
	f.events = append(f.events, ev)
	return nil
}

func (f *fakeRepo) Get(_ context.Context, id uuid.UUID) (Record, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	a, ok := f.assets[id]
	if !ok || a.Deleted() {
		return Record{}, ErrNotFound
	}
	return Record{Asset: a, Open: f.open(id)}, nil
}

func (f *fakeRepo) Assignments(_ context.Context, assetID uuid.UUID) ([]Assignment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Assignment, 0)
	for i := len(f.assignments) - 1; i >= 0; i-- {
		if a := f.assignments[i]; a.AssetID == assetID {
			a.EmployeeName = f.employees[a.EmployeeID].FullName()
			a.SignedCopies = make([]SignedCopy, 0)
			for j := len(f.copies) - 1; j >= 0; j-- {
				if f.copies[j].AssignmentID == a.ID {
					a.SignedCopies = append(a.SignedCopies, f.copies[j])
				}
			}
			a.SignedCopyUploaded = len(a.SignedCopies) > 0
			out = append(out, a)
		}
	}
	return out, nil
}

func (f *fakeRepo) AddSignedCopy(_ context.Context, assetID, assignmentID uuid.UUID, fn SignedCopyFunc) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.assets[assetID]
	if !ok || cur.Deleted() {
		return ErrNotFound
	}
	for _, as := range f.assignments {
		if as.ID == assignmentID && as.AssetID == assetID {
			c, ev, err := fn(cur, as)
			if err != nil {
				return err
			}
			f.copies = append(f.copies, c)
			f.events = append(f.events, ev)
			return nil
		}
	}
	return ErrAssignmentNotFound
}

func (f *fakeRepo) SignedCopy(_ context.Context, assetID, assignmentID, copyID uuid.UUID) (SignedCopy, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.copies {
		if c.ID == copyID && c.AssignmentID == assignmentID {
			for _, as := range f.assignments {
				if as.ID == assignmentID && as.AssetID == assetID {
					return c, nil
				}
			}
		}
	}
	return SignedCopy{}, ErrNotFound
}

func (f *fakeRepo) List(_ context.Context, lf ListFilter) ([]Record, int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Record, 0)
	for _, a := range f.assets {
		if lf.Category != nil && (a.Category == nil || *a.Category != *lf.Category) {
			continue
		}
		if a.Kind == lf.Kind && !a.Deleted() {
			out = append(out, Record{Asset: a, Open: f.open(a.ID)})
		}
	}
	return out, len(out), nil
}

func (f *fakeRepo) Summary(_ context.Context, kind Kind) (Summary, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := Summary{Providers: make([]string, 0)}
	for _, a := range f.assets {
		if a.Kind != kind || a.Deleted() {
			continue
		}
		s.Total++
		if a.Provider != nil && !slices.Contains(s.Providers, *a.Provider) {
			s.Providers = append(s.Providers, *a.Provider)
		}
		o := f.open(a.ID)
		switch {
		case o == nil:
			s.InOffice++
		default:
			s.WithEmployees++
			if o.NotReturnedAt != nil {
				s.NotReturned++
			}
		}
	}
	return s, nil
}

func (f *fakeRepo) ByNumber(_ context.Context, q string, limit int) ([]Record, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	q = strings.ToLower(q)
	out := make([]Record, 0)
	for _, a := range f.assets {
		hay := strings.ToLower(compactSIM(a.InventoryNo + "|" + deref(a.SimNo) + "|" + deref(a.PhoneNo)))
		if !a.Deleted() && strings.Contains(hay, q) && len(out) < limit {
			out = append(out, Record{Asset: a, Open: f.open(a.ID)})
		}
	}
	return out, nil
}

func (f *fakeRepo) ByEmployee(_ context.Context, employeeID uuid.UUID) ([]Held, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Held, 0)
	for _, a := range f.assignments {
		if a.EmployeeID == employeeID {
			out = append(out, Held{Assignment: a, Asset: f.assets[a.AssetID]})
		}
	}
	return out, nil
}

func (f *fakeRepo) Employee(_ context.Context, id uuid.UUID) (EmployeeView, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	e, ok := f.employees[id]
	if !ok {
		return EmployeeView{}, ErrEmployeeNotFound
	}
	return e, nil
}

func (f *fakeRepo) LastNumber(_ context.Context, prefix string) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.counters[prefix], nil
}

func (f *fakeRepo) NumberOwner(_ context.Context, number string) (uuid.UUID, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if id, ok := f.numbers[strings.ToUpper(number)]; ok {
		return id, nil
	}
	return uuid.Nil, ErrNotFound
}

func (f *fakeRepo) SIMOwner(_ context.Context, simNo string) (uuid.UUID, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, a := range f.assets {
		if !a.Deleted() && a.SimNo != nil && compactSIM(*a.SimNo) == compactSIM(simNo) {
			return a.ID, nil
		}
	}
	return uuid.Nil, ErrNotFound
}

func (f *fakeRepo) Update(_ context.Context, id uuid.UUID, m Mutation) (Record, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.assets[id]
	if !ok || cur.Deleted() {
		return Record{}, ErrNotFound
	}
	open := f.open(id)
	next, evs, err := m(cur, open)
	if err != nil {
		return Record{}, err
	}
	if f.simTaken(next) {
		return Record{}, ErrSIMNoTaken
	}
	if err := f.useNumber(id, next.InventoryNo); err != nil {
		return Record{}, err
	}
	if b := BumpOf(next); b != nil && !strings.EqualFold(cur.InventoryNo, next.InventoryNo) && b.N > f.counters[b.Prefix] {
		f.counters[b.Prefix] = b.N
	}
	f.assets[id] = next
	f.events = append(f.events, evs...)
	return Record{Asset: next, Open: open}, nil
}

func (f *fakeRepo) Give(_ context.Context, assetID, employeeID uuid.UUID, fn GiveFunc) (Assignment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.assets[assetID]
	if !ok || cur.Deleted() {
		return Assignment{}, ErrNotFound
	}
	emp, ok := f.employees[employeeID]
	if !ok {
		return Assignment{}, ErrEmployeeNotFound
	}
	next, a, evs, err := fn(cur, f.open(assetID), emp)
	if err != nil {
		return Assignment{}, err
	}
	if f.open(assetID) != nil {
		return Assignment{}, ErrAlreadyGiven
	}
	f.assets[assetID] = next
	f.assignments = append(f.assignments, a)
	f.events = append(f.events, evs...)
	return a, nil
}

func (f *fakeRepo) UpdateOpen(_ context.Context, assetID uuid.UUID, fn OpenMutation) (Assignment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.assets[assetID]
	if !ok || cur.Deleted() {
		return Assignment{}, ErrNotFound
	}
	next, evs, err := fn(cur, f.open(assetID))
	if err != nil {
		return Assignment{}, err
	}
	for i := range f.assignments {
		if f.assignments[i].ID == next.ID {
			f.assignments[i] = next
		}
	}
	f.events = append(f.events, evs...)
	return next, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// The organisation's day is 2026-10-09 in Vilnius, whatever UTC says.
var (
	testNow   = time.Date(2026, 10, 9, 9, 0, 0, 0, time.UTC)
	testActor = uuid.New()
	vilnius   = mustLoad("Europe/Vilnius")
)

func mustLoad(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

func sp(s string) *string { return &s }
func ip(n int64) *int64   { return &n }

type fixture struct {
	repo *fakeRepo
	svc  *Service
	ctx  context.Context
	emp  EmployeeView
	emp2 EmployeeView
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	repo := newFakeRepo()
	f := &fixture{repo: repo, svc: NewService(repo, WithClock(func() time.Time { return testNow }), WithLocation(vilnius)), ctx: context.Background()}
	f.emp = EmployeeView{ID: uuid.New(), FirstName: "Jonas", LastName: "Petraitis", Code: sp("0142")}
	f.emp2 = EmployeeView{ID: uuid.New(), FirstName: "Rūta", LastName: "Kazlauskienė"}
	repo.employees[f.emp.ID], repo.employees[f.emp2.ID] = f.emp, f.emp2
	return f
}

// sim adds a SIM card; complete gives it the phone, plan and value a form needs.
func (f *fixture) sim(t *testing.T, number string, status Status, complete bool) View {
	t.Helper()
	p := CreateParams{Kind: KindSIM, ConnectionStatus: &status, Params: Params{
		InventoryNo: number, SimNo: sp("0089370 " + number[len(number)-4:]), Provider: sp("Telia"),
	}}
	if complete {
		p.PhoneNo, p.Plan, p.NonReturnValueCents = sp("+370 612 40118"), sp("Biz 10 GB"), ip(2500)
	}
	v, err := f.svc.Create(f.ctx, p, testActor)
	if err != nil {
		t.Fatalf("add %s: %v", number, err)
	}
	return v
}

// give previews and gives the asset, as the form does after Print Form.
func (f *fixture) give(t *testing.T, id uuid.UUID, emp EmployeeView, date string) (AssignmentView, error) {
	t.Helper()
	fp := FormParams{EmployeeID: emp.ID, GivenDate: date}
	prev, err := f.svc.Preview(f.ctx, id, fp)
	if err != nil {
		return AssignmentView{}, err
	}
	return f.svc.Give(f.ctx, id, GiveParams{FormParams: fp, PaperFormSigned: true, FormHash: prev.DocumentHash}, testActor)
}

func (f *fixture) eventNames() []string {
	var out []string
	for _, e := range f.repo.events {
		out = append(out, e.Event)
	}
	return out
}

func TestAddSIMCardDefaults(t *testing.T) {
	f := newFixture(t)
	v := f.sim(t, "SIM-000001", StatusNotActivated, false)
	if v.Location != LocationOffice || v.Open != nil {
		t.Errorf("new SIM: location %s, open %v; want Office with no holder", v.Location, v.Open)
	}
	if *v.ConnectionStatus != StatusNotActivated || *v.ReceivedDate != "2026-10-09" || v.Currency != "EUR" {
		t.Errorf("defaults: %s, received %s, %s", *v.ConnectionStatus, *v.ReceivedDate, v.Currency)
	}
	if *v.SimNo != "0089370 0001" {
		t.Errorf("SIM number stored as %q, want it as typed", *v.SimNo)
	}
	// No status given: Not Activated (§4).
	v, err := f.svc.Create(f.ctx, CreateParams{Kind: KindSIM, Params: Params{InventoryNo: "SIM-000002", SimNo: sp("8937"), Provider: sp("Bitė")}}, testActor)
	if err != nil || *v.ConnectionStatus != StatusNotActivated {
		t.Errorf("default status = %v, %v", v.ConnectionStatus, err)
	}
	if got := f.eventNames(); !slices.Equal(got, []string{EventRegistered, EventRegistered}) {
		t.Errorf("events = %v", got)
	}
}

func TestCreateValidation(t *testing.T) {
	f := newFixture(t)
	future := "2026-10-10"
	for name, p := range map[string]CreateParams{
		"no kind":               {Params: Params{InventoryNo: "X-1"}},
		"no inventory number":   {Kind: KindSIM, Params: Params{SimNo: sp("1"), Provider: sp("Telia")}},
		"SIM without number":    {Kind: KindSIM, Params: Params{InventoryNo: "SIM-1", Provider: sp("Telia")}},
		"SIM without provider":  {Kind: KindSIM, Params: Params{InventoryNo: "SIM-1", SimNo: sp("1")}},
		"SIM number letters":    {Kind: KindSIM, Params: Params{InventoryNo: "SIM-1", SimNo: sp("12-34"), Provider: sp("Telia")}},
		"bad phone":             {Kind: KindSIM, Params: Params{InventoryNo: "SIM-1", SimNo: sp("1"), PhoneNo: sp("call me"), Provider: sp("Telia")}},
		"future received":       {Kind: KindSIM, Params: Params{InventoryNo: "SIM-1", SimNo: sp("1"), Provider: sp("Telia"), ReceivedDate: &future}},
		"SIM with a name":       {Kind: KindSIM, Params: Params{InventoryNo: "SIM-1", SimNo: sp("1"), Provider: sp("Telia"), Name: sp("x")}},
		"equipment no name":     {Kind: KindEquipment, Params: Params{InventoryNo: "PC-1", Category: ptr(CategoryComputer)}},
		"equipment no category": {Kind: KindEquipment, Params: Params{InventoryNo: "PC-1", Name: sp("Laptop")}},
		"equipment SIM field":   {Kind: KindEquipment, Params: Params{InventoryNo: "PC-1", Name: sp("Laptop"), Category: ptr(CategoryComputer), Provider: sp("Telia")}},
		"equipment status":      {Kind: KindEquipment, ConnectionStatus: ptr(StatusActive), Params: Params{InventoryNo: "PC-1", Name: sp("Laptop"), Category: ptr(CategoryComputer)}},
		"negative value":        {Kind: KindEquipment, Params: Params{InventoryNo: "PC-1", Name: sp("Laptop"), Category: ptr(CategoryComputer), NonReturnValueCents: ip(-1)}},
	} {
		if _, err := f.svc.Create(f.ctx, p, testActor); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v, want ErrInvalid", name, err)
		}
	}
	if _, err := f.svc.Create(f.ctx, CreateParams{Kind: KindSIM, Params: Params{InventoryNo: "SIM-1", SimNo: sp("1"), Provider: sp("T")}}, uuid.Nil); !errors.Is(err, ErrInvalid) {
		t.Errorf("no actor: %v", err)
	}
}

func ptr[T any](v T) *T { return &v }

func TestDuplicateNumbersNameTheExistingAsset(t *testing.T) {
	f := newFixture(t)
	first := f.sim(t, "SIM-000001", StatusActive, false)
	// The same SIM number with other spaces is the same card (§4).
	_, err := f.svc.Create(f.ctx, CreateParams{Kind: KindSIM, Params: Params{InventoryNo: "SIM-000002", SimNo: sp("00893700001"), Provider: sp("Telia")}}, testActor)
	var dup *DuplicateError
	if !errors.Is(err, ErrSIMNoTaken) || !errors.As(err, &dup) || dup.ExistingID() != first.ID {
		t.Errorf("duplicate SIM number: %v", err)
	}
	// An inventory number, case-insensitively.
	_, err = f.svc.Create(f.ctx, CreateParams{Kind: KindSIM, Params: Params{InventoryNo: "sim-000001", SimNo: sp("777"), Provider: sp("Telia")}}, testActor)
	if !errors.Is(err, ErrInventoryNoTaken) || !errors.As(err, &dup) || dup.ExistingID() != first.ID {
		t.Errorf("duplicate inventory number: %v", err)
	}
	if n := len(f.repo.assets); n != 1 {
		t.Errorf("%d assets stored, want 1", n)
	}
}

func TestNextNumberFollowsTheCounterAndSkipsUsedNumbers(t *testing.T) {
	f := newFixture(t)
	if n, err := f.svc.NextNumber(f.ctx, "SIM"); err != nil || n != "SIM-000001" {
		t.Errorf("first = %s, %v", n, err)
	}
	f.sim(t, "SIM-000001", StatusActive, false)
	if n, _ := f.svc.NextNumber(f.ctx, "SIM"); n != "SIM-000002" {
		t.Errorf("after 1 = %s", n)
	}
	// A company number typed in moves the counter past it (§16).
	f.sim(t, "SIM-000005", StatusActive, false)
	if n, _ := f.svc.NextNumber(f.ctx, "SIM"); n != "SIM-000006" {
		t.Errorf("after 5 = %s", n)
	}
	// A number used but not counted is skipped.
	f.repo.numbers["SIM-000006"] = uuid.New()
	if n, _ := f.svc.NextNumber(f.ctx, "SIM"); n != "SIM-000007" {
		t.Errorf("skipping a used number = %s", n)
	}
	if n, _ := f.svc.NextNumber(f.ctx, "PC"); n != "PC-000001" {
		t.Errorf("computers = %s", n)
	}
	if _, err := f.svc.NextNumber(f.ctx, "XX"); !errors.Is(err, ErrInvalid) {
		t.Errorf("unknown prefix: %v", err)
	}
	// Edit taking an own-prefix number raises the counter too.
	v := f.sim(t, "SIM-000007", StatusActive, true)
	p := Params{InventoryNo: "SIM-000020", SimNo: v.SimNo, PhoneNo: v.PhoneNo, Provider: v.Provider, Plan: v.Plan,
		NonReturnValueCents: v.NonReturnValueCents, ReceivedDate: v.ReceivedDate}
	if _, err := f.svc.Update(f.ctx, v.ID, p, testActor); err != nil {
		t.Fatal(err)
	}
	if n, _ := f.svc.NextNumber(f.ctx, "SIM"); n != "SIM-000021" {
		t.Errorf("after editing to 20 = %s", n)
	}
}

func TestChangeStatus(t *testing.T) {
	f := newFixture(t)
	v := f.sim(t, "SIM-000001", StatusNotActivated, true)
	got, err := f.svc.ChangeStatus(f.ctx, v.ID, "ACTIVE", testActor)
	if err != nil || *got.ConnectionStatus != StatusActive || got.Location != LocationOffice {
		t.Fatalf("activate = %+v, %v", got, err)
	}
	ev := f.repo.events[len(f.repo.events)-1]
	if ev.Event != EventStatusChanged || string(ev.Before) != `{"connection_status":"NOT_ACTIVATED"}` || string(ev.After) != `{"connection_status":"ACTIVE"}` {
		t.Errorf("event = %s %s → %s", ev.Event, ev.Before, ev.After)
	}
	n := len(f.repo.events)
	if _, err := f.svc.ChangeStatus(f.ctx, v.ID, "ACTIVE", testActor); err != nil || len(f.repo.events) != n {
		t.Errorf("same status: %v, %d new events", err, len(f.repo.events)-n)
	}
	if _, err := f.svc.ChangeStatus(f.ctx, v.ID, "LOST", testActor); !errors.Is(err, ErrInvalid) {
		t.Errorf("unknown status: %v", err)
	}
	pc, _ := f.svc.Create(f.ctx, CreateParams{Kind: KindEquipment, Params: Params{InventoryNo: "PC-000001", Name: sp("Laptop"), Category: ptr(CategoryComputer)}}, testActor)
	if _, err := f.svc.ChangeStatus(f.ctx, pc.ID, "ACTIVE", testActor); !errors.Is(err, ErrInvalid) {
		t.Errorf("equipment status: %v", err)
	}
}

func TestGiveRefusesWhatCannotBeGiven(t *testing.T) {
	f := newFixture(t)
	na := f.sim(t, "SIM-000001", StatusNotActivated, true)
	blocked := f.sim(t, "SIM-000002", StatusBlocked, true)
	incomplete := f.sim(t, "SIM-000003", StatusActive, false)
	ok := f.sim(t, "SIM-000004", StatusActive, true)

	for name, id := range map[string]uuid.UUID{"not activated": na.ID, "blocked": blocked.ID} {
		_, err := f.svc.Give(f.ctx, id, GiveParams{FormParams: FormParams{EmployeeID: f.emp.ID, GivenDate: "2026-10-09"}, PaperFormSigned: true}, testActor)
		if !errors.Is(err, ErrNotActive) {
			t.Errorf("%s: %v, want ErrNotActive", name, err)
		}
	}
	if _, err := f.give(t, incomplete.ID, f.emp, "2026-10-09"); !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "phone_no") {
		t.Errorf("no phone number: %v", err)
	}
	fp := FormParams{EmployeeID: f.emp.ID, GivenDate: "2026-10-09"}
	prev, err := f.svc.Preview(f.ctx, ok.ID, fp)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Give(f.ctx, ok.ID, GiveParams{FormParams: fp, FormHash: prev.DocumentHash}, testActor); !errors.Is(err, ErrInvalid) ||
		!strings.Contains(err.Error(), "paper_form_signed") {
		t.Errorf("not signed: %v", err)
	}
	// The form printed was for another date: the paper differs from what would be stored.
	if _, err := f.svc.Give(f.ctx, ok.ID, GiveParams{FormParams: FormParams{EmployeeID: f.emp.ID, GivenDate: "2026-10-08"},
		PaperFormSigned: true, FormHash: prev.DocumentHash}, testActor); !errors.Is(err, ErrFormChanged) {
		t.Errorf("changed after printing: %v", err)
	}
	if _, err := f.give(t, ok.ID, f.emp, "2026-10-10"); !errors.Is(err, ErrInvalid) {
		t.Errorf("future given date: %v", err)
	}
	if _, err := f.give(t, ok.ID, EmployeeView{ID: uuid.New()}, "2026-10-09"); !errors.Is(err, ErrEmployeeNotFound) {
		t.Errorf("unknown employee: %v", err)
	}
	if len(f.repo.assignments) != 0 {
		t.Errorf("%d assignments stored after refusals", len(f.repo.assignments))
	}
}

func TestGiveUpdatesEverythingTogether(t *testing.T) {
	f := newFixture(t)
	v := f.sim(t, "SIM-000001", StatusActive, true)
	a, err := f.give(t, v.ID, f.emp, "2026-10-01")
	if err != nil {
		t.Fatal(err)
	}
	if a.EmployeeName != "Jonas Petraitis" || a.DaysHeld != 8 || !a.PaperFormSigned || a.DocumentHash == nil || a.Form == nil {
		t.Errorf("assignment = %+v", a)
	}
	got, _ := f.svc.Get(f.ctx, v.ID)
	if got.Location != LocationWithEmployee || got.Open == nil || got.Open.EmployeeID != f.emp.ID || len(got.Assignments) != 1 {
		t.Errorf("after giving: %s, open %+v, %d assignments", got.Location, got.Open, len(got.Assignments))
	}
	if s, _ := f.svc.Summary(f.ctx, "SIM"); s.Total != 1 || s.WithEmployees != 1 || s.InOffice != 0 || !slices.Equal(s.Providers, []string{"Telia"}) {
		t.Errorf("summary = %+v", s)
	}
	held, _ := f.svc.HeldBy(f.ctx, f.emp.ID)
	if !slices.Equal(held, []string{"SIM-000001"}) {
		t.Errorf("held by = %v", held)
	}
	// A second giving, by a double click or another user (§7).
	if _, err := f.give(t, v.ID, f.emp2, "2026-10-09"); !errors.Is(err, ErrAlreadyGiven) {
		t.Errorf("second give: %v, want ErrAlreadyGiven", err)
	}
	ev := f.repo.events[len(f.repo.events)-1]
	if ev.Event != EventGiven || !strings.Contains(string(ev.After), `"employee_name":"Jonas Petraitis"`) {
		t.Errorf("event = %s %s", ev.Event, ev.After)
	}
}

func TestGiveFillsAMissingPlanAndValue(t *testing.T) {
	f := newFixture(t)
	v := f.sim(t, "SIM-000001", StatusActive, false)
	if _, err := f.svc.Update(f.ctx, v.ID, Params{InventoryNo: v.InventoryNo, SimNo: v.SimNo, Provider: v.Provider,
		PhoneNo: sp("+370 600 00001"), ReceivedDate: v.ReceivedDate}, testActor); err != nil {
		t.Fatal(err)
	}
	fp := FormParams{EmployeeID: f.emp.ID, GivenDate: "2026-10-09", Plan: sp("Biz 5 GB"), NonReturnValueCents: ip(1500)}
	prev, err := f.svc.Preview(f.ctx, v.ID, fp)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Give(f.ctx, v.ID, GiveParams{FormParams: fp, PaperFormSigned: true, FormHash: prev.DocumentHash}, testActor); err != nil {
		t.Fatal(err)
	}
	got, _ := f.svc.Get(f.ctx, v.ID)
	if *got.Plan != "Biz 5 GB" || *got.NonReturnValueCents != 1500 {
		t.Errorf("plan %v, value %v saved on the card", got.Plan, got.NonReturnValueCents)
	}
	names := f.eventNames()
	if !slices.Equal(names[len(names)-2:], []string{EventUpdated, EventGiven}) {
		t.Errorf("events = %v", names)
	}
	// A plan the card has is changed with Edit, not on the Give form.
	w := f.sim(t, "SIM-000002", StatusActive, true)
	_, err = f.svc.Preview(f.ctx, w.ID, FormParams{EmployeeID: f.emp.ID, GivenDate: "2026-10-09", Plan: sp("Other")})
	if !errors.Is(err, ErrInvalid) {
		t.Errorf("changing a set plan: %v", err)
	}
}

func TestGiveWithoutAPlan(t *testing.T) {
	f := newFixture(t)
	v := f.sim(t, "SIM-000001", StatusActive, false)
	if _, err := f.svc.Update(f.ctx, v.ID, Params{InventoryNo: v.InventoryNo, SimNo: v.SimNo, Provider: v.Provider,
		PhoneNo: sp("+370 600 00001"), NonReturnValueCents: ip(1500), ReceivedDate: v.ReceivedDate}, testActor); err != nil {
		t.Fatal(err)
	}
	a, err := f.give(t, v.ID, f.emp, "2026-10-09")
	if err != nil {
		t.Fatalf("a card without a plan: %v", err)
	}
	// The form keeps the plan's place, empty.
	if !strings.Contains(string(a.Form), `"plan":null`) {
		t.Errorf("form = %s", a.Form)
	}
}

func TestPrintingAndTheBlockingEmailAreRecorded(t *testing.T) {
	f := newFixture(t)
	v := f.sim(t, "SIM-000001", StatusActive, true)
	fp := FormParams{EmployeeID: f.emp.ID, GivenDate: "2026-10-09"}
	prev, err := f.svc.Preview(f.ctx, v.ID, fp)
	if err != nil {
		t.Fatal(err)
	}
	// Print Form: the form Give would store, for whom, nothing else changed.
	if err := f.svc.RecordFormPrinted(f.ctx, v.ID, fp, testActor); err != nil {
		t.Fatal(err)
	}
	ev := f.repo.events[len(f.repo.events)-1]
	if ev.Event != EventFormPrinted || ev.EntityID != v.ID || *ev.ActorUserID != testActor || ev.Before != nil ||
		!strings.Contains(string(ev.After), prev.DocumentHash) || !strings.Contains(string(ev.After), f.emp.ID.String()) {
		t.Errorf("printed: %s %s", ev.Event, ev.After)
	}
	if got, _ := f.svc.Get(f.ctx, v.ID); got.Open != nil {
		t.Error("printing gave the card")
	}
	// A form that could not be printed is not recorded.
	n := len(f.repo.events)
	if err := f.svc.RecordFormPrinted(f.ctx, v.ID, FormParams{GivenDate: "2026-10-09"}, testActor); !errors.Is(err, ErrInvalid) || len(f.repo.events) != n {
		t.Errorf("no employee: %v, %d events", err, len(f.repo.events)-n)
	}

	// Print form again: the assignment's stored form.
	a, err := f.give(t, v.ID, f.emp, "2026-10-09")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.RecordFormReprinted(f.ctx, v.ID, a.ID, testActor); err != nil {
		t.Fatal(err)
	}
	ev = f.repo.events[len(f.repo.events)-1]
	if ev.Event != EventFormPrinted || !strings.Contains(string(ev.After), a.ID.String()) || !strings.Contains(string(ev.After), *a.DocumentHash) {
		t.Errorf("reprinted: %s %s", ev.Event, ev.After)
	}
	if err := f.svc.RecordFormReprinted(f.ctx, v.ID, uuid.New(), testActor); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown assignment: %v", err)
	}

	// Prepare Blocking Email: a SIM card's numbers and its holder.
	if err := f.svc.RecordBlockingEmail(f.ctx, v.ID, testActor); err != nil {
		t.Fatal(err)
	}
	ev = f.repo.events[len(f.repo.events)-1]
	if ev.Event != EventBlockingEmailPrepared || !strings.Contains(string(ev.After), `"sim_no"`) || !strings.Contains(string(ev.After), a.ID.String()) {
		t.Errorf("blocking email: %s %s", ev.Event, ev.After)
	}
	for name, err := range map[string]error{
		"no actor":   f.svc.RecordBlockingEmail(f.ctx, v.ID, uuid.Nil),
		"no asset":   f.svc.RecordBlockingEmail(f.ctx, uuid.New(), testActor),
		"print, nil": f.svc.RecordFormPrinted(f.ctx, v.ID, fp, uuid.Nil),
	} {
		if err == nil {
			t.Errorf("%s: recorded", name)
		}
	}
}

func TestBlockingNeitherReturnsNorMoves(t *testing.T) {
	f := newFixture(t)
	v := f.sim(t, "SIM-000001", StatusActive, true)
	if _, err := f.give(t, v.ID, f.emp, "2026-10-01"); err != nil {
		t.Fatal(err)
	}
	got, err := f.svc.ChangeStatus(f.ctx, v.ID, "BLOCKED", testActor)
	if err != nil || got.Location != LocationWithEmployee || got.Open == nil || got.Open.EmployeeID != f.emp.ID {
		t.Errorf("blocked: %s, open %+v, %v", got.Location, got.Open, err)
	}
	if s, _ := f.svc.Summary(f.ctx, "SIM"); s.InOffice != 0 {
		t.Errorf("in office = %d after blocking, want 0", s.InOffice)
	}
}

func TestReturnKeepsTheStatusAndHistory(t *testing.T) {
	f := newFixture(t)
	for _, status := range []Status{StatusActive, StatusBlocked} {
		t.Run(string(status), func(t *testing.T) {
			v := f.sim(t, "SIM-00000"+map[Status]string{StatusActive: "1", StatusBlocked: "2"}[status], StatusActive, true)
			if _, err := f.give(t, v.ID, f.emp, "2026-10-01"); err != nil {
				t.Fatal(err)
			}
			if status == StatusBlocked {
				if _, err := f.svc.ChangeStatus(f.ctx, v.ID, "BLOCKED", testActor); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := f.svc.Return(f.ctx, v.ID, ReturnParams{ReturnedDate: "2026-09-30"}, testActor); !errors.Is(err, ErrInvalid) {
				t.Errorf("return before giving: %v", err)
			}
			a, err := f.svc.Return(f.ctx, v.ID, ReturnParams{Comment: "back at the desk"}, testActor)
			if err != nil || *a.ReturnedDate != "2026-10-09" || a.DaysHeld != 8 {
				t.Fatalf("return = %+v, %v", a, err)
			}
			got, _ := f.svc.Get(f.ctx, v.ID)
			if got.Location != LocationOffice || got.Open != nil || *got.ConnectionStatus != status || len(got.Assignments) != 1 {
				t.Errorf("after return: %s, open %v, status %s, %d assignments", got.Location, got.Open, *got.ConnectionStatus, len(got.Assignments))
			}
			if _, err := f.svc.Return(f.ctx, v.ID, ReturnParams{}, testActor); !errors.Is(err, ErrNotGiven) {
				t.Errorf("second return: %v", err)
			}
		})
	}
}

func TestNotReturned(t *testing.T) {
	f := newFixture(t)
	v := f.sim(t, "SIM-000001", StatusActive, true)
	if _, err := f.svc.MarkNotReturned(f.ctx, v.ID, NotReturnedParams{Whereabouts: "UNKNOWN"}, testActor); !errors.Is(err, ErrNotGiven) {
		t.Errorf("not given: %v", err)
	}
	if _, err := f.give(t, v.ID, f.emp, "2026-10-01"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.MarkNotReturned(f.ctx, v.ID, NotReturnedParams{Whereabouts: "LOST"}, testActor); !errors.Is(err, ErrInvalid) {
		t.Errorf("bad whereabouts: %v", err)
	}
	if _, err := f.svc.MarkNotReturned(f.ctx, v.ID, NotReturnedParams{Whereabouts: "UNKNOWN", Comment: "Stopped answering"}, testActor); err != nil {
		t.Fatal(err)
	}
	got, _ := f.svc.Get(f.ctx, v.ID)
	if got.Location != LocationUnknown || got.Open == nil || got.Open.EmployeeName != "Jonas Petraitis" {
		t.Errorf("unknown: %s, last holder %+v", got.Location, got.Open)
	}
	if s, _ := f.svc.Summary(f.ctx, "SIM"); s.Total != 1 || s.WithEmployees != 1 || s.NotReturned != 1 {
		t.Errorf("summary = %+v", s)
	}
	if _, err := f.svc.MarkNotReturned(f.ctx, v.ID, NotReturnedParams{Whereabouts: "WITH_EMPLOYEE"}, testActor); !errors.Is(err, ErrAlreadyMarked) {
		t.Errorf("second mark: %v", err)
	}
	// Found later: an ordinary return, and the mark stays (§13).
	a, err := f.svc.Return(f.ctx, v.ID, ReturnParams{}, testActor)
	if err != nil || a.NotReturnedAt == nil || a.Whereabouts == nil {
		t.Errorf("return after the mark = %+v, %v", a, err)
	}
}

func TestANewHolderIsANewAssignment(t *testing.T) {
	f := newFixture(t)
	v := f.sim(t, "SIM-000001", StatusActive, true)
	first, err := f.give(t, v.ID, f.emp, "2026-09-01")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Return(f.ctx, v.ID, ReturnParams{ReturnedDate: "2026-09-20"}, testActor); err != nil {
		t.Fatal(err)
	}
	// The plan changes after the first giving (§19): the first form keeps it.
	if _, err := f.svc.Update(f.ctx, v.ID, Params{InventoryNo: v.InventoryNo, SimNo: v.SimNo, Provider: v.Provider, PhoneNo: v.PhoneNo,
		Plan: sp("Biz 20 GB"), NonReturnValueCents: ip(3000), ReceivedDate: v.ReceivedDate}, testActor); err != nil {
		t.Fatal(err)
	}
	second, err := f.give(t, v.ID, f.emp2, "2026-10-02")
	if err != nil {
		t.Fatal(err)
	}
	if *first.DocumentHash == *second.DocumentHash {
		t.Error("the new holder's form has the first form's hash")
	}
	got, _ := f.svc.Get(f.ctx, v.ID)
	if len(got.Assignments) != 2 || got.Assignments[0].EmployeeID != f.emp2.ID || got.Assignments[1].EmployeeID != f.emp.ID {
		t.Fatalf("assignments = %+v", got.Assignments)
	}
	if got.Assignments[1].DaysHeld != 19 {
		t.Errorf("first holder's days = %d, want 19", got.Assignments[1].DaysHeld)
	}
	old, err := f.svc.Form(f.ctx, v.ID, first.ID)
	if err != nil || old.DocumentHash != *first.DocumentHash || !strings.Contains(string(old.Form), `"plan":"Biz 10 GB"`) {
		t.Errorf("first form = %s %s, %v", old.Form, old.DocumentHash, err)
	}
}

func TestFurnitureNeedsNoForm(t *testing.T) {
	f := newFixture(t)
	desk, err := f.svc.Create(f.ctx, CreateParams{Kind: KindEquipment, Params: Params{InventoryNo: "FUR-000001", Name: sp("Desk"), Category: ptr(CategoryFurniture)}}, testActor)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Preview(f.ctx, desk.ID, FormParams{EmployeeID: f.emp.ID, GivenDate: "2026-10-09"}); !errors.Is(err, ErrNoForm) {
		t.Errorf("preview: %v, want ErrNoForm", err)
	}
	fp := FormParams{EmployeeID: f.emp.ID, GivenDate: "2026-10-09"}
	if _, err := f.svc.Give(f.ctx, desk.ID, GiveParams{FormParams: fp, PaperFormSigned: true}, testActor); !errors.Is(err, ErrInvalid) {
		t.Errorf("signed tick on furniture: %v", err)
	}
	if got, _ := f.svc.Get(f.ctx, desk.ID); got.NeedsForm {
		t.Error("a desk needs a form")
	}
	if res, _ := f.svc.List(f.ctx, ListParams{Kind: "EQUIPMENT", Category: "FURNITURE"}); res.Total != 1 {
		t.Errorf("furniture listed = %d, want 1", res.Total)
	}
	a, err := f.svc.Give(f.ctx, desk.ID, GiveParams{FormParams: fp}, testActor)
	if err != nil || a.Form != nil || a.PaperFormSigned {
		t.Errorf("give desk = %+v, %v", a, err)
	}
	if _, err := f.svc.Form(f.ctx, desk.ID, a.ID); !errors.Is(err, ErrNoForm) {
		t.Errorf("form: %v", err)
	}
	// A laptop needs a form, and its value for it.
	pc, _ := f.svc.Create(f.ctx, CreateParams{Kind: KindEquipment, Params: Params{InventoryNo: "PC-000001", Name: sp("Laptop"), Category: ptr(CategoryComputer)}}, testActor)
	if !pc.NeedsForm {
		t.Error("a laptop needs no form")
	}
	if _, err := f.svc.Preview(f.ctx, pc.ID, fp); !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "non_return_value_cents") {
		t.Errorf("laptop without value: %v", err)
	}
}

func TestEditRecordsChangedDetailsOnly(t *testing.T) {
	f := newFixture(t)
	v := f.sim(t, "SIM-000001", StatusActive, true)
	n := len(f.repo.events)
	same := Params{InventoryNo: v.InventoryNo, SimNo: v.SimNo, PhoneNo: v.PhoneNo, Provider: v.Provider, Plan: v.Plan,
		NonReturnValueCents: v.NonReturnValueCents, ReceivedDate: v.ReceivedDate}
	if _, err := f.svc.Update(f.ctx, v.ID, same, testActor); err != nil || len(f.repo.events) != n {
		t.Errorf("unchanged edit: %v, %d events", err, len(f.repo.events)-n)
	}
	changed := same
	changed.Plan, changed.Comment = sp("Biz 20 GB"), "Spare card"
	if _, err := f.svc.Update(f.ctx, v.ID, changed, testActor); err != nil {
		t.Fatal(err)
	}
	ev := f.repo.events[len(f.repo.events)-1]
	if ev.Event != EventUpdated || string(ev.Before) != `{"plan":"Biz 10 GB"}` || string(ev.After) != `{"comment_changed":true,"plan":"Biz 20 GB"}` {
		t.Errorf("event = %s %s → %s", ev.Event, ev.Before, ev.After)
	}
	// A corrected inventory number may not be another asset's.
	other := f.sim(t, "SIM-000002", StatusActive, false)
	taken := same
	taken.InventoryNo = other.InventoryNo
	var dup *DuplicateError
	if _, err := f.svc.Update(f.ctx, v.ID, taken, testActor); !errors.As(err, &dup) || dup.ExistingID() != other.ID {
		t.Errorf("taken number: %v", err)
	}
}

func TestByNumberIgnoresSpaces(t *testing.T) {
	f := newFixture(t)
	f.sim(t, "SIM-000001", StatusActive, true)
	for _, q := range []string{"61240", "612 40", "sim-0000", "0001"} {
		if vs, err := f.svc.ByNumber(f.ctx, q); err != nil || len(vs) != 1 {
			t.Errorf("%q: %d, %v", q, len(vs), err)
		}
	}
	if vs, _ := f.svc.ByNumber(f.ctx, "  "); len(vs) != 0 {
		t.Errorf("blank matched %d", len(vs))
	}
}

func TestListParams(t *testing.T) {
	f := newFixture(t)
	for _, p := range []ListParams{
		{}, {Kind: "CAR"}, {Kind: "SIM", Location: "HOME"}, {Kind: "SIM", Status: "LOST"}, {Kind: "SIM", NotReturned: "yes"},
		{Kind: "EQUIPMENT", Category: "TABLE"}, {Kind: "SIM", Held: "yes"}, {Kind: "SIM", Sort: "price"}, {Kind: "SIM", Dir: "up"}, {Kind: "SIM", Page: "0"}, {Kind: "SIM", PageSize: "101"},
		{Kind: "SIM", Page: "200000000000000000"},
	} {
		if _, err := f.svc.List(f.ctx, p); !errors.Is(err, ErrInvalid) {
			t.Errorf("%+v: %v, want ErrInvalid", p, err)
		}
	}
	if res, err := f.svc.List(f.ctx, ListParams{Kind: "SIM"}); err != nil || res.Page != 1 || res.PageSize != 50 || res.Assets == nil {
		t.Errorf("defaults = %+v, %v", res, err)
	}
}

func TestDaysHeldCountsCalendarDays(t *testing.T) {
	for _, c := range []struct {
		from, to string
		want     int
	}{{"2026-10-09", "2026-10-09", 0}, {"2026-03-02", "2026-10-09", 221}, {"2025-11-18", "2026-10-09", 325}, {"2026-10-10", "2026-10-09", 0}} {
		if got := daysBetween(c.from, c.to); got != c.want {
			t.Errorf("%s → %s = %d, want %d", c.from, c.to, got, c.want)
		}
	}
}

func TestUploadSignedCopy(t *testing.T) {
	f := newFixture(t)
	v := f.sim(t, "SIM-000001", StatusActive, true)
	given, err := f.give(t, v.ID, f.emp, "2026-10-09")
	if err != nil {
		t.Fatal(err)
	}
	pdf := Upload{FileName: `C:\Scans\Jonas form (signed).PDF`, Data: []byte("%PDF-1.7\n1 0 obj\n%%EOF")}
	if _, err := f.svc.UploadSignedCopy(f.ctx, v.ID, given.ID, pdf, testActor); !errors.Is(err, ErrNoStorage) {
		t.Errorf("without storage: %v", err)
	}
	root := t.TempDir()
	store, err := files.NewDir(root)
	if err != nil {
		t.Fatal(err)
	}
	svc := NewService(f.repo, WithClock(func() time.Time { return testNow }), WithLocation(vilnius), WithFiles(store))
	for name, c := range map[string]struct {
		id   uuid.UUID
		u    Upload
		want error
	}{
		"empty":            {given.ID, Upload{FileName: "a.pdf"}, ErrInvalid},
		"too large":        {given.ID, Upload{FileName: "a.pdf", Data: append([]byte("%PDF-"), make([]byte, MaxSignedCopyBytes)...)}, ErrFileTooLarge},
		"a web page":       {given.ID, Upload{FileName: "form.pdf", Data: []byte("<html><script>alert(1)</script>")}, ErrFileType},
		"a cut photo":      {given.ID, Upload{FileName: "a.jpg", Data: []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00}}, ErrInvalid},
		"not this asset's": {uuid.New(), pdf, ErrAssignmentNotFound},
	} {
		if _, err := svc.UploadSignedCopy(f.ctx, v.ID, c.id, c.u, testActor); !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", name, err, c.want)
		}
	}
	if stored, _ := filepath.Glob(filepath.Join(root, "signed-copies", "*", "*")); len(stored) != 0 {
		t.Errorf("refused uploads left files: %v", stored)
	}

	first, err := svc.UploadSignedCopy(f.ctx, v.ID, given.ID, pdf, testActor)
	if err != nil {
		t.Fatal(err)
	}
	if first.FileName != "Jonas form signed.pdf" || first.ContentType != files.PDF || first.SizeBytes != int64(len(pdf.Data)) || len(first.SHA256) != 64 {
		t.Errorf("copy = %+v", first)
	}
	if got := f.eventNames(); got[len(got)-1] != EventSignedCopyUploaded {
		t.Errorf("events = %v", got)
	}
	_, r, err := svc.SignedCopy(f.ctx, v.ID, given.ID, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := io.ReadAll(r); string(b) != string(pdf.Data) {
		t.Errorf("read back %q", b)
	}
	r.Close()
	// Uploading again keeps the first; the newest comes first.
	second, err := svc.UploadSignedCopy(f.ctx, v.ID, given.ID, Upload{FileName: "photo.jpeg", Data: tinyJPEG(t)}, testActor)
	if err != nil || second.ContentType != files.JPEG || second.FileName != "photo.jpg" {
		t.Fatalf("second = %+v, %v", second, err)
	}
	d, _ := svc.Get(f.ctx, v.ID)
	if as := d.Assignments[0]; !as.SignedCopyUploaded || len(as.SignedCopies) != 2 || as.SignedCopies[0].ID != second.ID {
		t.Errorf("assignment = %+v", as.Assignment)
	}
	if _, _, err := svc.SignedCopy(f.ctx, v.ID, uuid.New(), first.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("another assignment's copy: %v", err)
	}

	// Furniture is given without a form, so it has no signed copy.
	desk, _ := f.svc.Create(f.ctx, CreateParams{Kind: KindEquipment, Params: Params{InventoryNo: "FUR-000001", Name: sp("Desk"), Category: ptr(CategoryFurniture)}}, testActor)
	deskGiven, err := f.svc.Give(f.ctx, desk.ID, GiveParams{FormParams: FormParams{EmployeeID: f.emp.ID, GivenDate: "2026-10-09"}}, testActor)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UploadSignedCopy(f.ctx, desk.ID, deskGiven.ID, pdf, testActor); !errors.Is(err, ErrNoForm) {
		t.Errorf("a desk's copy: %v", err)
	}
}

func tinyJPEG(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, image.NewGray(image.Rect(0, 0, 2, 2)), nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestCopyName(t *testing.T) {
	for in, want := range map[string]string{
		"scan.pdf":               "scan.pdf",
		"/tmp/x/Rūta's form.PNG": "Rūtas form.pdf",
		`..\..\evil".pdf`:        "evil.pdf",
		"":                       "signed-form.pdf",
		"<script>.pdf":           "script.pdf",
	} {
		if got := copyName(in, files.PDF); got != want {
			t.Errorf("copyName(%q) = %q, want %q", in, got, want)
		}
	}
}
