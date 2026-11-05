package document

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// fakeRepo keeps everything in memory and calls Mutate as the Postgres one does.
type fakeRepo struct {
	mu        sync.Mutex
	employees map[uuid.UUID]EmployeeRecord
	subjects  map[uuid.UUID]Subject
	documents map[uuid.UUID]Document
	sealed    map[uuid.UUID][]byte
	numbers   map[string]Ref // number index + state
	copies    map[uuid.UUID][]Copy
	events    []audit.Event
	failSave  error
	removed   map[uuid.UUID]bool
	retention map[uuid.UUID]Retention
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{employees: map[uuid.UUID]EmployeeRecord{}, subjects: map[uuid.UUID]Subject{},
		documents: map[uuid.UUID]Document{}, sealed: map[uuid.UUID][]byte{}, numbers: map[string]Ref{}, copies: map[uuid.UUID][]Copy{},
		removed: map[uuid.UUID]bool{}, retention: map[uuid.UUID]Retention{}}
}

func (r *fakeRepo) DocumentByNumber(_ context.Context, idx []byte, state string) (Ref, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ref, ok := r.numbers[string(idx)+state]
	return ref, ok, nil
}

func (r *fakeRepo) SubjectByPersonalCode(_ context.Context, idx []byte) (uuid.UUID, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, s := range r.subjects {
		if s.PersonalIndex != nil && bytes.Equal(s.PersonalIndex, idx) {
			return id, true, nil
		}
	}
	return uuid.Nil, false, nil
}

func (r *fakeRepo) Subject(_ context.Context, id uuid.UUID) (Subject, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.subjects[id]
	return s, ok, nil
}

func (r *fakeRepo) PossibleDuplicates(_ context.Context, first, last string, birth *string) ([]uuid.UUID, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []uuid.UUID{}
	for id, e := range r.employees {
		if strings.EqualFold(e.FirstName, first) && strings.EqualFold(e.LastName, last) {
			out = append(out, id)
		}
	}
	return out, nil
}

func (r *fakeRepo) Documents(_ context.Context, id uuid.UUID) ([]Document, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []Document{}
	for _, d := range r.documents {
		if d.EmployeeID == id {
			out = append(out, d)
		}
	}
	return out, nil
}

func (r *fakeRepo) Save(_ context.Context, rec SaveRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failSave != nil {
		return r.failSave
	}
	cur, ok := r.employees[rec.EmployeeID]
	if rec.NewEmployee != nil {
		cur = *rec.NewEmployee
	} else if !ok {
		return ErrEmployeeNotFound
	}
	var superseded []Document
	for _, d := range r.documents {
		if d.EmployeeID == rec.EmployeeID && d.Kind == rec.Document.Kind && d.SupersededAt == nil {
			superseded = append(superseded, d)
		}
	}
	next, events, err := rec.Mutate(cur, superseded)
	if err != nil {
		return err
	}
	r.employees[next.ID] = next
	if s := rec.NewSubject; s != nil {
		r.subjects[s.EmployeeID] = *s
	} else if rec.PersonalIndex != nil {
		s := r.subjects[rec.EmployeeID]
		s.PersonalIndex = rec.PersonalIndex
		r.subjects[rec.EmployeeID] = s
	}
	for _, d := range superseded {
		at := rec.Document.CreatedAt
		d.SupersededAt = &at
		r.documents[d.ID] = d
	}
	r.documents[rec.Document.ID] = rec.Document
	r.sealed[rec.Document.ID] = rec.Sealed
	r.numbers[string(rec.NumberIndex)+rec.Document.IssuingState] = Ref{EmployeeID: rec.EmployeeID, DocumentID: rec.Document.ID}
	r.copies[rec.Document.ID] = rec.Copies
	r.events = append(r.events, events...)
	return nil
}

func (r *fakeRepo) Document(_ context.Context, id uuid.UUID) (Opened, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	d, ok := r.documents[id]
	if !ok || r.removed[id] {
		return Opened{}, ErrNotFound
	}
	sub := r.subjects[d.EmployeeID]
	return Opened{Document: d, Sealed: r.sealed[id], Copies: r.copies[id], SealedKey: sub.SealedKey, KeyID: sub.KeyID}, nil
}

func (r *fakeRepo) Record(_ context.Context, events []audit.Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, events...)
	return nil
}

func (r *fakeRepo) UpdateDocument(_ context.Context, id uuid.UUID, mutate func(Document) (DocumentChange, []audit.Event, error)) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	d, ok := r.documents[id]
	if !ok || r.removed[id] {
		return ErrNotFound
	}
	change, events, err := mutate(d)
	if err != nil || len(events) == 0 {
		return err
	}
	d.OnEmployeeRecord = change.OnEmployeeRecord
	r.documents[id] = d
	if change.Removed {
		r.removed[id] = true
	}
	r.events = append(r.events, events...)
	return nil
}

func (r *fakeRepo) UpdateSubject(_ context.Context, employeeID uuid.UUID, mutate func(Retention) (Retention, []audit.Event, error)) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.subjects[employeeID]; !ok {
		return ErrNotFound
	}
	next, events, err := mutate(r.retention[employeeID])
	if err != nil || len(events) == 0 {
		return err
	}
	r.retention[employeeID] = next
	r.events = append(r.events, events...)
	return nil
}

func (r *fakeRepo) Retention(_ context.Context, id uuid.UUID) (Retention, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.subjects[id]
	return r.retention[id], ok, nil
}

func (r *fakeRepo) Due(_ context.Context, today string, months int) ([]uuid.UUID, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []uuid.UUID
	for id := range r.subjects {
		ret := r.retention[id]
		if ret.EmploymentEndedOn == nil || (ret.HoldUntil != nil && *ret.HoldUntil >= today) {
			continue
		}
		ended, _ := time.Parse(time.DateOnly, *ret.EmploymentEndedOn)
		if ended.AddDate(0, months, 0).Format(time.DateOnly) <= today {
			out = append(out, id)
		}
	}
	return out, nil
}

func (r *fakeRepo) Shred(_ context.Context, employeeID uuid.UUID, events func(int) []audit.Event) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.subjects[employeeID]; !ok {
		return nil, nil
	}
	var keys []string
	n := 0
	for id, d := range r.documents {
		if d.EmployeeID == employeeID {
			for _, c := range r.copies[id] {
				keys = append(keys, c.ObjectKey)
			}
			delete(r.documents, id)
			delete(r.sealed, id)
			delete(r.copies, id)
			n++
		}
	}
	delete(r.subjects, employeeID)
	delete(r.retention, employeeID)
	r.events = append(r.events, events(n)...)
	return keys, nil
}

// fakeStore is the files store in memory.
type fakeStore struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (s *fakeStore) Put(_ context.Context, key string, body io.Reader, _ int64, _ string) error {
	b, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.objects[key] = b
	return nil
}

func (s *fakeStore) Get(_ context.Context, key string) (io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.objects[key]
	if !ok {
		return nil, errors.New("no such object")
	}
	return io.NopCloser(bytes.NewReader(b)), nil
}

func (s *fakeStore) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.objects, key)
	return nil
}

func newTestService(t *testing.T) (*Service, *fakeRepo, *fakeStore) {
	t.Helper()
	repo, store := newFakeRepo(), &fakeStore{objects: map[string][]byte{}}
	return NewService(repo, testKeys(t), store, WithClock(func() time.Time { return today })), repo, store
}

func passportParams(t *testing.T, p person, employee uuid.UUID) SaveParams {
	t.Helper()
	sp := SaveParams{EmployeeID: employee, MRZ: td3(p), Kind: Passport, Surname: "Pavyzdys", GivenNames: "Jonas",
		Copies: map[Side][]byte{SidePage: jpegBytes(t, 40, 30)}}
	if employee == uuid.Nil {
		sp.New = &NewEmployee{FirstName: "Jonas", LastName: "Pavyzdys"}
	}
	return sp
}

// noLeak fails when an event, error or the stored objects carry a value read
// from the document (PR-2).
func noLeak(t *testing.T, repo *fakeRepo, store *fakeStore, values ...string) {
	t.Helper()
	for _, ev := range repo.events {
		for _, v := range values {
			if bytes.Contains(ev.Before, []byte(v)) || bytes.Contains(ev.After, []byte(v)) {
				t.Errorf("event %s holds %q: %s %s", ev.Event, v, ev.Before, ev.After)
			}
		}
	}
	for key, obj := range store.objects {
		if bytes.HasPrefix(obj, []byte{0xff, 0xd8}) {
			t.Errorf("object %s is a plain JPEG", key)
		}
	}
	for id, sealed := range repo.sealed {
		for _, v := range values {
			if bytes.Contains(sealed, []byte(v)) {
				t.Errorf("document %s is stored with %q in plain", id, v)
			}
		}
	}
}

func eventNames(evs []audit.Event) []string {
	out := make([]string, len(evs))
	for i, e := range evs {
		out[i] = e.Event
	}
	return out
}

func TestSaveNewEmployeeFromPassport(t *testing.T) {
	svc, repo, store := newTestService(t)
	actor := uuid.New()
	doc, err := svc.Save(context.Background(), passportParams(t, jonas, uuid.Nil), actor)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Kind != Passport || doc.IssuingState != "LTU" || doc.ExpiresOn != "2031-05-15" || len(doc.Copies) != 1 {
		t.Errorf("document = %+v", doc)
	}
	e := repo.employees[doc.EmployeeID]
	if e.FirstName != "Jonas" || e.LastName != "Pavyzdys" || e.BirthDate != nil {
		t.Errorf("employee = %+v (no Add to Employee Record: no birth date)", e)
	}
	if got := eventNames(repo.events); strings.Join(got, ",") != "employee.created,"+EventRecorded {
		t.Errorf("events = %v", got)
	}
	if len(store.objects) != 1 {
		t.Errorf("objects = %d, want 1", len(store.objects))
	}
	noLeak(t, repo, store, "91234567", "33309240064", "PAVYZDYS", "330924")

	// The sealed fields open with the person's data key, and only for this document.
	s := repo.subjects[doc.EmployeeID]
	box, err := svc.keys.openDataKey(doc.EmployeeID, s.SealedKey, s.KeyID)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := box.Open(repo.sealed[doc.ID], documentContext(doc.ID))
	if err != nil {
		t.Fatal(err)
	}
	var f Fields
	if err := json.Unmarshal(plain, &f); err != nil {
		t.Fatal(err)
	}
	if f.Number != "91234567" || f.PersonalCode != "33309240064" || f.BirthDate != "1933-09-24" || f.Surname != "Pavyzdys" {
		t.Errorf("sealed fields = %+v", f)
	}
	if _, err := box.Open(repo.sealed[doc.ID], documentContext(uuid.New())); err == nil {
		t.Error("the sealed fields open for another document")
	}
	c := repo.copies[doc.ID][0]
	jpg, err := box.Open(store.objects[c.ObjectKey], copyContext(c.ID))
	if err != nil || !bytes.Equal(sha256Of(jpg), c.SHA256) {
		t.Errorf("the copy does not open to its JPEG: %v", err)
	}
	if !strings.HasPrefix(c.ObjectKey, "personnel/"+doc.EmployeeID.String()+"/") {
		t.Errorf("object key = %s", c.ObjectKey)
	}
}

func TestSaveAddsToEmployeeRecordOnlyWhatIsTaken(t *testing.T) {
	svc, repo, store := newTestService(t)
	emp := uuid.New()
	repo.employees[emp] = EmployeeRecord{ID: emp, FirstName: "Jon", LastName: "Pavyzdys"}
	p := passportParams(t, jonas, emp)
	p.AddToEmployeeRecord = true
	p.Take = []Take{TakeBirthDate, TakeSex, TakeNames}
	if _, err := svc.Save(context.Background(), p, uuid.New()); err != nil {
		t.Fatal(err)
	}
	e := repo.employees[emp]
	if e.BirthDate == nil || *e.BirthDate != "1933-09-24" || e.Sex == nil || *e.Sex != "M" || e.Nationality != nil || e.FirstName != "Jonas" {
		t.Errorf("employee = %+v", e)
	}
	var updated *audit.Event
	for i := range repo.events {
		if repo.events[i].Event == "employee.updated" {
			updated = &repo.events[i]
		}
	}
	if updated == nil || !strings.Contains(string(updated.After), `"birth_date_changed":true`) || !strings.Contains(string(updated.After), `"first_name":"Jonas"`) {
		t.Fatalf("employee.updated = %+v", updated)
	}
	noLeak(t, repo, store, "1933-09-24", "33309240064", "91234567")

	p.Take = []Take{TakeSex}
	p.AddToEmployeeRecord = false
	if _, err := svc.Save(context.Background(), p, uuid.New()); !errors.Is(err, ErrInvalid) {
		t.Errorf("Take without Add to Employee Record = %v, want ErrInvalid", err)
	}
}

func TestSaveSupersedesTheEarlierDocumentOfItsKind(t *testing.T) {
	svc, repo, _ := newTestService(t)
	first, err := svc.Save(context.Background(), passportParams(t, jonas, uuid.Nil), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	renewed := jonas
	renewed.number, renewed.expiry = "93456789", "360101"
	second, err := svc.Save(context.Background(), passportParams(t, renewed, first.EmployeeID), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if repo.documents[first.ID].SupersededAt == nil || repo.documents[second.ID].SupersededAt != nil {
		t.Errorf("first superseded = %v, second = %v", repo.documents[first.ID].SupersededAt, repo.documents[second.ID].SupersededAt)
	}
	if got := eventNames(repo.events[2:]); strings.Join(got, ",") != EventSuperseded+","+EventRecorded {
		t.Errorf("second save's events = %v", got)
	}
	if len(repo.subjects) != 1 {
		t.Errorf("subjects = %d, want the one person's", len(repo.subjects))
	}
}

func TestSaveRefusesDuplicatesAndLeavesNoObjects(t *testing.T) {
	svc, repo, store := newTestService(t)
	first, err := svc.Save(context.Background(), passportParams(t, jonas, uuid.Nil), uuid.New())
	if err != nil {
		t.Fatal(err)
	}

	// The same document again, for anyone.
	_, err = svc.Save(context.Background(), passportParams(t, jonas, uuid.Nil), uuid.New())
	var dup *DuplicateError
	if !errors.As(err, &dup) || dup.What != duplicateDocument || dup.DocumentID != first.ID || !errors.Is(err, ErrDuplicate) {
		t.Fatalf("same document = %v, want document_on_file", err)
	}

	// Another document with Jonas's personal code, for another employee.
	other := uuid.New()
	repo.employees[other] = EmployeeRecord{ID: other, FirstName: "Someone", LastName: "Else"}
	card := SaveParams{EmployeeID: other, MRZ: td1(jonas), Kind: IDCard, Surname: "Else"}
	card.MRZ = td1(person{surname: "ELSE", given: "SOMEONE", number: "95555555", birth: "330924", sex: "M", expiry: "310515",
		personalCode: "33309240064", issuingState: "LTU"})
	_, err = svc.Save(context.Background(), card, uuid.New())
	if !errors.As(err, &dup) || dup.What != duplicateOtherEmployee || dup.EmployeeID != first.EmployeeID {
		t.Fatalf("another's personal code = %v, want other_employee", err)
	}

	// A save the repository refuses deletes the objects it wrote.
	before := len(store.objects)
	repo.failSave = errors.New("boom")
	if _, err := svc.Save(context.Background(), passportParams(t, ona, uuid.Nil), uuid.New()); err == nil {
		t.Fatal("the failed save succeeded")
	}
	if len(store.objects) != before {
		t.Errorf("objects after a failed save = %d, want %d", len(store.objects), before)
	}
}

func TestSaveRefusesWhatIsWrong(t *testing.T) {
	svc, repo, store := newTestService(t)
	emp := uuid.New()
	repo.employees[emp] = EmployeeRecord{ID: emp, FirstName: "Jonas", LastName: "Pavyzdys"}
	ok := func() SaveParams { return passportParams(t, jonas, emp) }

	broken := ok()
	broken.MRZ = []string{broken.MRZ[0], strings.Replace(broken.MRZ[1], "3309243", "3309253", 1)}
	var problems *ProblemsError
	if _, err := svc.Save(context.Background(), broken, uuid.New()); !errors.As(err, &problems) || !errors.Is(err, ErrInvalid) {
		t.Errorf("a wrong check digit = %v, want ProblemsError", err)
	} else if strings.Contains(err.Error(), "330925") {
		t.Errorf("the error names a value: %v", err)
	}

	cases := map[string]func(p *SaveParams){
		"kind against the code": func(p *SaveParams) { p.Kind = IDCard; p.Copies = nil },
		"a passport's front":    func(p *SaveParams) { p.Copies = map[Side][]byte{SideFront: jpegBytes(t, 4, 4)} },
		"no surname":            func(p *SaveParams) { p.Surname = "" },
		"both employees":        func(p *SaveParams) { p.New = &NewEmployee{FirstName: "A", LastName: "B"} },
		"issued after expiry":   func(p *SaveParams) { p.IssuedOn = "2032-01-01" },
		"not a date":            func(p *SaveParams) { p.IssuedOn = "5 Nov" },
	}
	for name, change := range cases {
		p := ok()
		change(&p)
		if _, err := svc.Save(context.Background(), p, uuid.New()); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v, want ErrInvalid", name, err)
		}
	}
	png := ok()
	png.Copies = map[Side][]byte{SidePage: pngBytes(t)}
	if _, err := svc.Save(context.Background(), png, uuid.New()); !errors.Is(err, ErrCopyNotJPEG) {
		t.Errorf("a PNG copy = %v, want ErrCopyNotJPEG", err)
	}
	big := ok()
	big.Copies = map[Side][]byte{SidePage: jpegBytes(t, 2401, 10)}
	if _, err := svc.Save(context.Background(), big, uuid.New()); !errors.Is(err, ErrCopyNotJPEG) {
		t.Errorf("a 2401 px copy = %v, want ErrCopyNotJPEG", err)
	}
	if len(repo.documents) != 0 || len(store.objects) != 0 {
		t.Errorf("refused saves wrote %d documents, %d objects", len(repo.documents), len(store.objects))
	}
}

func TestCheck(t *testing.T) {
	svc, repo, _ := newTestService(t)
	saved, err := svc.Save(context.Background(), passportParams(t, jonas, uuid.Nil), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	r, err := svc.Check(context.Background(), CheckParams{MRZ: td3(jonas), Surname: "Pavyzdys", GivenNames: "Jonas"})
	if err != nil {
		t.Fatal(err)
	}
	if !r.Valid || r.DocumentOnFile == nil || r.DocumentOnFile.DocumentID != saved.ID || r.OtherEmployee == nil ||
		*r.OtherEmployee != saved.EmployeeID || len(r.PossibleDuplicates) != 1 || r.NameMatch != "same" {
		t.Errorf("check of a document on file, for a new employee = %+v", r)
	}
	r, err = svc.Check(context.Background(), CheckParams{EmployeeID: saved.EmployeeID, MRZ: td3(ona), Surname: "Kita"})
	if err != nil {
		t.Fatal(err)
	}
	if r.DocumentOnFile != nil || r.OtherEmployee != nil || len(r.PossibleDuplicates) != 0 || r.NameMatch != "differs" {
		t.Errorf("check of another document for the chosen employee = %+v", r)
	}
	if _, err := svc.Check(context.Background(), CheckParams{MRZ: []string{"P<LTU"}}); !errors.Is(err, ErrInvalid) {
		t.Errorf("no MRZ = %v, want ErrInvalid", err)
	}
	_ = repo
}

func TestNotConfigured(t *testing.T) {
	svc := NewService(newFakeRepo(), Keys{}, &fakeStore{objects: map[string][]byte{}})
	if _, err := svc.Check(context.Background(), CheckParams{MRZ: td3(jonas)}); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("Check without keys = %v", err)
	}
	if _, err := svc.Save(context.Background(), passportParams(t, jonas, uuid.Nil), uuid.New()); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("Save without keys = %v", err)
	}
	svc = NewService(newFakeRepo(), testKeys(t), nil)
	if _, err := svc.Save(context.Background(), passportParams(t, jonas, uuid.Nil), uuid.New()); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("Save without a store = %v", err)
	}
}
