package employee

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// The fake's employments: live periods per employee, the status derived as
// Postgres's reads derive it.

func (f *fakeRepo) companyLive(id uuid.UUID) bool { _, ok := f.companies[id]; return ok }

// CompanyName answers Companies from the fake's companies.
func (f *fakeRepo) CompanyName(_ context.Context, id uuid.UUID) (string, bool, error) {
	name, ok := f.companies[id]
	return name, ok, nil
}

// refresh sets row id's status and company from its periods.
func (f *fakeRepo) refresh(id uuid.UUID) {
	e := f.rows[id]
	e.Status, e.Company = statusOf(f.jobs[id]), nil
	for _, m := range f.jobs[id] {
		if m.Open() {
			e.Company = &CompanyRef{ID: m.CompanyID, Name: f.companies[m.CompanyID]}
		}
	}
	f.rows[id] = e
}

func (f *fakeRepo) Employments(_ context.Context, id uuid.UUID) ([]Employment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Employment{}, f.jobs[id]...), nil
}

func (f *fakeRepo) UpdateEmployments(_ context.Context, id uuid.UUID, m EmploymentMutation) (Employee, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.rows[id]
	if !ok || cur.Deleted() {
		return Employee{}, ErrNotFound
	}
	jobs := f.jobs[id]
	writes, evs, err := m(cur, append([]Employment{}, jobs...))
	if err != nil {
		return Employee{}, err
	}
	next := append([]Employment{}, jobs...)
	for _, w := range writes {
		i := slices.IndexFunc(next, func(o Employment) bool { return o.ID == w.ID })
		if (i < 0 || next[i].CompanyID != w.CompanyID) && !f.companyLive(w.CompanyID) {
			return Employee{}, ErrCompanyNotFound
		}
		switch {
		case w.DeletedAt != nil:
			next = slices.Delete(next, i, i+1)
		case i < 0:
			next = append(next, w)
		default:
			next[i] = w
		}
	}
	open := 0
	for _, o := range next {
		if o.Open() {
			open++
		}
	}
	if open > 1 {
		return Employee{}, ErrEmployed
	}
	f.jobs[id] = next
	f.refresh(id)
	f.events = append(f.events, evs...)
	return f.rows[id], nil
}

// employer adds a live company to the fake and returns its id.
func employer(repo *fakeRepo, name string) uuid.UUID {
	id := uuid.New()
	repo.companies[id] = name
	return id
}

func lastEvent(repo *fakeRepo) string { return repo.events[len(repo.events)-1].Event }

var manage = Rights{Profile: true}

func TestCreateCandidateOrEmployee(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	gavort := employer(repo, "UAB Gavort")
	cand, err := svc.Create(ctx, Params{FirstName: "Ona", LastName: "Kandidatė"}, manage, testActor)
	if err != nil || cand.Status != StatusCandidate || cand.Company != nil {
		t.Fatalf("candidate = %+v, %v", cand, err)
	}
	emp, err := svc.Create(ctx, Params{FirstName: "Jonas", LastName: "Darbuotojas",
		Employment: &EmployParams{CompanyID: gavort, StartedOn: sp2("2026-11-02")}}, manage, testActor)
	if err != nil || emp.Status != StatusEmployee || emp.Company == nil || emp.Company.Name != "UAB Gavort" {
		t.Fatalf("employee = %+v, %v", emp, err)
	}
	if got := repo.events[len(repo.events)-2:]; got[0].Event != EventCreated || got[1].Event != EventEmployed {
		t.Fatalf("events = %v", got)
	}
	got, err := svc.Get(ctx, emp.ID)
	if err != nil || len(got.Employments) != 1 || *got.Employments[0].StartedOn != "2026-11-02" {
		t.Fatalf("Get = %+v, %v", got, err)
	}
	if _, err := svc.Create(ctx, Params{FirstName: "A", LastName: "B", Employment: &EmployParams{CompanyID: uuid.New()}}, manage, testActor); !errors.Is(err, ErrCompanyNotFound) {
		t.Fatalf("unknown company: err = %v", err)
	}
	if _, err := svc.Create(ctx, Params{FirstName: "A", LastName: "B", Employment: &EmployParams{CompanyID: gavort, StartedOn: sp2("2026-13-01")}}, manage, testActor); !errors.Is(err, ErrInvalid) {
		t.Fatalf("bad date: err = %v", err)
	}
}

func TestEmployMoveEndRemove(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	a, b := employer(repo, "A"), employer(repo, "B")
	e, _ := svc.Create(ctx, Params{FirstName: "Ona", LastName: "K"}, manage, testActor)

	if _, err := svc.Employ(ctx, e.ID, EmployParams{CompanyID: a, StartedOn: sp2("2026-01-10")}, Rights{}, testActor); !errors.Is(err, ErrNotPermitted) {
		t.Fatalf("without manage: err = %v", err)
	}
	got, err := svc.Employ(ctx, e.ID, EmployParams{CompanyID: a, StartedOn: sp2("2026-01-10")}, manage, testActor)
	if err != nil || got.Status != StatusEmployee || got.Company.ID != a || lastEvent(repo) != EventEmployed {
		t.Fatalf("Employ = %+v, %v", got, err)
	}
	if _, err := svc.Employ(ctx, e.ID, EmployParams{CompanyID: b, StartedOn: sp2("2026-03-01")}, manage, testActor); !errors.Is(err, ErrEmployed) {
		t.Fatalf("a second open one: err = %v", err)
	}
	if _, err := svc.Employ(ctx, e.ID, EmployParams{CompanyID: b, StartedOn: sp2("2025-12-01"), EndCurrent: true}, manage, testActor); !errors.Is(err, ErrInvalid) {
		t.Fatalf("moved before the current start: err = %v", err)
	}
	// Move to Another Company: the current ends the day the next starts.
	got, err = svc.Employ(ctx, e.ID, EmployParams{CompanyID: b, StartedOn: sp2("2026-03-01"), EndCurrent: true}, manage, testActor)
	if err != nil || got.Company.ID != b || len(got.Employments) != 2 || *got.Employments[0].EndedOn != "2026-03-01" && *got.Employments[1].EndedOn != "2026-03-01" {
		t.Fatalf("Move = %+v, %v", got, err)
	}
	if n := len(repo.events); repo.events[n-2].Event != EventEmploymentEnded || repo.events[n-1].Event != EventEmployed {
		t.Fatalf("move's events = %v %v", repo.events[n-2].Event, repo.events[n-1].Event)
	}
	var open Employment
	for _, m := range got.Employments {
		if m.Open() {
			open = m
		}
	}
	if _, err := svc.EndEmployment(ctx, e.ID, open.ID, "2026-02-01", manage, testActor); !errors.Is(err, ErrInvalid) {
		t.Fatalf("ended before it started: err = %v", err)
	}
	got, err = svc.EndEmployment(ctx, e.ID, open.ID, "2026-06-30", manage, testActor)
	if err != nil || got.Status != StatusFormer || got.Company != nil {
		t.Fatalf("End = %+v, %v", got, err)
	}
	if _, err := svc.EndEmployment(ctx, e.ID, open.ID, "2026-07-01", manage, testActor); !errors.Is(err, ErrEnded) {
		t.Fatalf("ended twice: err = %v", err)
	}
	// Re-employed later at A: no overlap with the past periods.
	if _, err := svc.Employ(ctx, e.ID, EmployParams{CompanyID: a, StartedOn: sp2("2026-05-01")}, manage, testActor); !errors.Is(err, ErrOverlap) {
		t.Fatalf("overlapping: err = %v", err)
	}
	got, err = svc.Employ(ctx, e.ID, EmployParams{CompanyID: a, StartedOn: sp2("2026-06-30")}, manage, testActor)
	if err != nil || got.Status != StatusEmployee {
		t.Fatalf("re-employed = %+v, %v", got, err)
	}
	// Remove every period: a candidate again.
	for _, m := range got.Employments {
		if got, err = svc.RemoveEmployment(ctx, e.ID, m.ID, manage, testActor); err != nil {
			t.Fatal(err)
		}
	}
	if got.Status != StatusCandidate || lastEvent(repo) != EventEmploymentRemoved {
		t.Fatalf("all removed = %+v", got)
	}
	if _, err := svc.RemoveEmployment(ctx, e.ID, uuid.New(), manage, testActor); !errors.Is(err, ErrEmploymentNotFound) {
		t.Fatalf("unknown period: err = %v", err)
	}
}

func TestUpdateEmployment(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	a, b := employer(repo, "A"), employer(repo, "B")
	e, _ := svc.Create(ctx, Params{FirstName: "Ona", LastName: "K", Employment: &EmployParams{CompanyID: a, StartedOn: sp2("2026-01-10")}}, manage, testActor)
	job := repo.jobs[e.ID][0]
	n := len(repo.events)
	if _, err := svc.UpdateEmployment(ctx, e.ID, job.ID, EmploymentParams{CompanyID: a, StartedOn: sp2("2026-01-10")}, manage, testActor); err != nil || len(repo.events) != n {
		t.Fatalf("unchanged: %v, %d events", err, len(repo.events)-n)
	}
	got, err := svc.UpdateEmployment(ctx, e.ID, job.ID, EmploymentParams{CompanyID: b, StartedOn: sp2("2026-01-12"), EndedOn: sp2("2026-02-01")}, manage, testActor)
	if err != nil || got.Status != StatusFormer || lastEvent(repo) != EventEmploymentChanged {
		t.Fatalf("Update = %+v, %v", got, err)
	}
	ev := repo.events[len(repo.events)-1]
	if string(ev.Before) == "" || !contains(string(ev.After), `"company":"B"`, `"ended_on":"2026-02-01"`, `"started_on":"2026-01-12"`) {
		t.Fatalf("event = %s → %s", ev.Before, ev.After)
	}
	if _, err := svc.UpdateEmployment(ctx, e.ID, job.ID, EmploymentParams{CompanyID: b, StartedOn: sp2("2026-03-01"), EndedOn: sp2("2026-02-01")}, manage, testActor); !errors.Is(err, ErrInvalid) {
		t.Fatalf("ends before it starts: err = %v", err)
	}
	// A second period, then the first edited to overlap it.
	if _, err := svc.Employ(ctx, e.ID, EmployParams{CompanyID: a, StartedOn: sp2("2026-03-01")}, manage, testActor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateEmployment(ctx, e.ID, job.ID, EmploymentParams{CompanyID: b, StartedOn: sp2("2026-01-12"), EndedOn: sp2("2026-03-02")}, manage, testActor); !errors.Is(err, ErrOverlap) {
		t.Fatalf("overlap: err = %v", err)
	}
	if _, err := svc.UpdateEmployment(ctx, e.ID, job.ID, EmploymentParams{CompanyID: b, StartedOn: sp2("2026-01-12")}, manage, testActor); !errors.Is(err, ErrEmployed) {
		t.Fatalf("reopened beside an open one: err = %v", err)
	}
}

func TestOverlaps(t *testing.T) {
	p := func(s, e *string) Employment { return Employment{StartedOn: s, EndedOn: e} }
	for _, c := range []struct {
		a, b Employment
		want bool
	}{
		{p(sp2("2026-01-01"), sp2("2026-02-01")), p(sp2("2026-02-01"), nil), false},
		{p(sp2("2026-01-01"), sp2("2026-02-02")), p(sp2("2026-02-01"), nil), true},
		{p(nil, sp2("2026-02-01")), p(sp2("2025-01-01"), sp2("2025-02-01")), true},
		{p(nil, nil), p(sp2("2030-01-01"), nil), true},
		{p(sp2("2026-03-01"), nil), p(sp2("2026-01-01"), sp2("2026-03-01")), false},
	} {
		if got := overlaps(c.a, c.b); got != c.want || overlaps(c.b, c.a) != c.want {
			t.Errorf("overlaps(%v, %v) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

func contains(s string, parts ...string) bool {
	for _, p := range parts {
		if !strings.Contains(s, p) {
			return false
		}
	}
	return true
}
