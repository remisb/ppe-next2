package document

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/vault"
)

// memRepo is an in-memory Repository.
type memRepo struct {
	mu       sync.Mutex
	docs     map[uuid.UUID]Document
	events   []audit.Event
	shredded []uuid.UUID
	numbers  map[string]int
	// texts are SetText's updates in order; queued the versions ReadAgain queued.
	texts  []TextUpdate
	queued []uuid.UUID
	// archives are the records QueueArchives queued.
	archives []uuid.UUID
}

func newMemRepo() *memRepo { return &memRepo{docs: map[uuid.UUID]Document{}} }

func (m *memRepo) Create(_ context.Context, d Document, links []Link, ev audit.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	d.Links = slices.Clone(links)
	d.Versions = slices.Clone(d.Versions)
	m.docs[d.ID] = d
	m.events = append(m.events, ev)
	return nil
}

func (m *memRepo) Get(_ context.Context, id uuid.UUID) (Document, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.docs[id]
	if !ok || d.DeletedAt != nil {
		return Document{}, ErrNotFound
	}
	// A copy, as a database read is: the caller may change it.
	d.Versions, d.Links = slices.Clone(d.Versions), slices.Clone(d.Links)
	return d, nil
}

func (m *memRepo) Update(ctx context.Context, id uuid.UUID, mut Mutation) (Document, error) {
	cur, err := m.Get(ctx, id)
	if err != nil {
		return Document{}, err
	}
	c, err := mut(cur)
	if err != nil {
		return Document{}, err
	}
	if len(c.Events) == 0 {
		return cur, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	c.Document.Links = slices.Clone(c.Links)
	m.docs[id] = c.Document
	m.events = append(m.events, c.Events...)
	return c.Document, nil
}

func (m *memRepo) AddVersion(ctx context.Context, id uuid.UUID, mut VersionMutation) (Document, error) {
	cur, err := m.Get(ctx, id)
	if err != nil {
		return Document{}, err
	}
	v, evs, err := mut(cur)
	if err != nil {
		return Document{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	cur.Versions = append([]Version{v}, cur.Versions...)
	m.docs[id] = cur
	m.events = append(m.events, evs...)
	return cur, nil
}

func (m *memRepo) Search(_ context.Context, q Query, perms []string) (Page, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p := Page{Documents: []Hit{}, Page: q.Page, PageSize: pageSize}
	for _, d := range m.docs {
		if d.DeletedAt != nil || !(Reader{Perms: perms}).holdsAll(d.Requires) {
			continue
		}
		if q.Subject != nil && !slices.ContainsFunc(d.Links, func(l Link) bool { return l.Kind == q.Subject.Kind && l.ID == q.Subject.ID }) {
			continue
		}
		p.Documents = append(p.Documents, Hit{ID: d.ID, Type: d.Type, Title: d.Title, Links: d.Links})
	}
	p.Total = len(p.Documents)
	return p, nil
}

func (m *memRepo) Subjects(context.Context) ([]Subject, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Subject
	for _, d := range m.docs {
		for _, l := range d.Links {
			s := Subject{l.Kind, l.ID}
			if !slices.Contains(out, s) {
				out = append(out, s)
			}
		}
	}
	return out, nil
}

func (m *memRepo) Relabel(_ context.Context, s Subject, label string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for id, d := range m.docs {
		for i, l := range d.Links {
			if l.Kind == s.Kind && l.ID == s.ID && l.Label != label {
				d.Links[i].Label = label
				n++
			}
		}
		m.docs[id] = d
	}
	return n, nil
}

func (m *memRepo) NextNumber(_ context.Context, typ string, year int) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.numbers == nil {
		m.numbers = map[string]int{}
	}
	k := fmt.Sprintf("%s/%d", typ, year)
	m.numbers[k]++
	return m.numbers[k], nil
}

func (m *memRepo) Record(_ context.Context, ev audit.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, ev)
	return nil
}

func (m *memRepo) Retained(_ context.Context, types []string) ([]Candidate, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Candidate
	for _, d := range m.docs {
		if !d.Sealed && !slices.Contains(types, d.Type) || slices.Contains(m.shredded, d.ID) {
			continue
		}
		c := Candidate{ID: d.ID, Type: d.Type, Number: d.Number, DocumentDate: d.DocumentDate, RetainUntil: d.RetainUntil,
			HoldUntil: d.HoldUntil, Removed: d.DeletedAt != nil, Sealed: d.Sealed, SourceKind: d.SourceKind, SourceID: d.SourceID}
		for _, l := range d.Links {
			if l.Kind == vault.Employee {
				c.Employees = append(c.Employees, l.ID)
			}
		}
		out = append(out, c)
	}
	return out, nil
}

func (m *memRepo) SetRetainUntil(_ context.Context, id uuid.UUID, day *string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	d := m.docs[id]
	d.RetainUntil = day
	m.docs[id] = d
	return nil
}

func (m *memRepo) Shred(_ context.Context, id uuid.UUID, _ time.Time, _ string, ev audit.Event) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d := m.docs[id]
	var keys []string
	for _, v := range d.Versions {
		keys = append(keys, v.File.ObjectKey)
	}
	delete(m.docs, id)
	m.shredded = append(m.shredded, id)
	m.events = append(m.events, ev)
	return keys, nil
}

func (m *memRepo) VersionDocument(_ context.Context, version uuid.UUID) (uuid.UUID, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, d := range m.docs {
		for _, v := range d.Versions {
			if v.ID == version {
				return id, nil
			}
		}
	}
	return uuid.Nil, ErrNotFound
}

// setState sets version's text state; the caller holds mu.
func (m *memRepo) setState(version uuid.UUID, state string) bool {
	for id, d := range m.docs {
		for i, v := range d.Versions {
			if v.ID == version {
				d.Versions = slices.Clone(d.Versions)
				d.Versions[i].TextState = state
				m.docs[id] = d
				return true
			}
		}
	}
	return false
}

func (m *memRepo) SetText(_ context.Context, version uuid.UUID, t TextUpdate) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.setState(version, t.State) {
		return ErrNotFound
	}
	m.texts = append(m.texts, t)
	return nil
}

func (m *memRepo) ReadAgain(_ context.Context, version uuid.UUID, _ time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.setState(version, TextPending) {
		return ErrNotFound
	}
	m.queued = append(m.queued, version)
	return nil
}

func (m *memRepo) QueueUnread(context.Context, bool, time.Time) (int64, error) { return 0, nil }

func (m *memRepo) SourceDocument(_ context.Context, kind string, id uuid.UUID) (uuid.UUID, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, d := range m.docs {
		if d.DeletedAt == nil && d.SourceKind != nil && *d.SourceKind == kind && *d.SourceID == id {
			return d.ID, nil
		}
	}
	return uuid.Nil, ErrNotFound
}

func (m *memRepo) AddSourced(ctx context.Context, d Document, mut VersionMutation) (Document, error) {
	id, err := m.SourceDocument(ctx, *d.SourceKind, *d.SourceID)
	if errors.Is(err, ErrNotFound) {
		d.Locked, d.Versions, d.Links = true, nil, slices.Clone(d.Links)
		m.mu.Lock()
		m.docs[d.ID] = d
		m.mu.Unlock()
		id = d.ID
	}
	return m.AddVersion(ctx, id, mut)
}

func (m *memRepo) SourcedFiles(_ context.Context, kind string, ids []uuid.UUID) ([]SourcedFile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]SourcedFile, 0)
	for _, d := range m.docs {
		if d.DeletedAt == nil && d.SourceKind != nil && *d.SourceKind == kind && slices.Contains(ids, *d.SourceID) {
			for _, v := range d.Versions {
				out = append(out, SourcedFile{SourceID: *d.SourceID, File: v.File, CreatedAt: v.CreatedAt, CreatedByUserID: v.CreatedByUserID})
			}
		}
	}
	return out, nil
}

func (m *memRepo) Sources(_ context.Context, kind string) ([]uuid.UUID, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []uuid.UUID
	for _, d := range m.docs {
		if d.DeletedAt == nil && d.SourceKind != nil && *d.SourceKind == kind {
			out = append(out, *d.SourceID)
		}
	}
	return out, nil
}

// eventNames are the recorded events' names in order.
func (m *memRepo) eventNames() []string {
	var out []string
	for _, e := range m.events {
		out = append(out, e.Event)
	}
	return out
}

// memStore is an in-memory files.Store.
type memStore struct {
	mu    sync.Mutex
	files map[string][]byte
}

func (s *memStore) Put(_ context.Context, key string, body io.Reader, _ int64, _ string) error {
	b, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.files[key] = b
	return nil
}

func (s *memStore) Get(_ context.Context, key string) (io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.files[key]
	if !ok {
		return nil, files.ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(b)), nil
}

func (s *memStore) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.files, key)
	return nil
}

func (s *memStore) String() string { return "mem" }

// stubSubjects describes the subjects it holds.
type stubSubjects map[uuid.UUID]SubjectInfo

func (s stubSubjects) Describe(_ context.Context, _ vault.SubjectKind, id uuid.UUID) (SubjectInfo, error) {
	info, ok := s[id]
	if !ok {
		return SubjectInfo{}, ErrSubjectNotFound
	}
	return info, nil
}

var (
	pdf       = []byte("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n")
	ana       = uuid.New()
	equipment = uuid.New()
	manager   = Reader{ID: uuid.New(), Perms: []string{vault.PermRead, vault.PermManage}}
	reader    = Reader{ID: uuid.New(), Perms: []string{vault.PermRead}}
)

type fixture struct {
	repo  *memRepo
	store *memStore
	svc   *Service
	subs  stubSubjects
}

func newFixture() fixture {
	f := fixture{repo: newMemRepo(), store: &memStore{files: map[string][]byte{}}, subs: stubSubjects{
		ana:       {Label: "Ana Žukauskaitė"},
		equipment: {Label: "EQ-0001 Laptop", Requires: []string{"equipment.read"}},
	}}
	at := time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC)
	f.svc = NewService(f.repo, f.subs, WithFiles(f.store), WithClock(func() time.Time { return at }))
	return f
}

func certificate(links ...LinkRef) Details {
	return Details{Title: "  Working at height  ", Links: links}
}

func TestUploadKeepsTheFileAndRecordsIt(t *testing.T) {
	f := newFixture()
	d, err := f.svc.Upload(context.Background(), manager, "employee.certificate",
		certificate(LinkRef{vault.Employee, ana}), Upload{FileName: `C:\scans\cert (1).pdf`, Data: pdf, Note: "first "})
	if err != nil {
		t.Fatal(err)
	}
	if d.Title != "Working at height" || d.Origin != vault.Uploaded || len(d.Versions) != 1 {
		t.Fatalf("document = %+v", d)
	}
	v := d.Current()
	if v.Number != 1 || v.Origin != VersionOriginal || v.Note != "first" || v.File.FileName != "cert 1.pdf" || v.File.ContentType != files.PDF {
		t.Fatalf("version = %+v", v)
	}
	if !strings.HasPrefix(v.File.ObjectKey, "vault/"+d.ID.String()+"/") || !bytes.Equal(f.store.files[v.File.ObjectKey], pdf) {
		t.Fatalf("stored %q: %v", v.File.ObjectKey, f.store.files)
	}
	if len(d.Links) != 1 || d.Links[0].Label != "Ana Žukauskaitė" {
		t.Fatalf("links = %+v", d.Links)
	}
	if !slices.Equal(d.Requires, []string{vault.PermRead}) {
		t.Errorf("requires = %v", d.Requires)
	}
	if got := f.repo.eventNames(); !slices.Equal(got, []string{EventUploaded}) {
		t.Fatalf("events = %v", got)
	}
	var after map[string]any
	if err := json.Unmarshal(f.repo.events[0].After, &after); err != nil {
		t.Fatal(err)
	}
	if after["sha256"] != v.File.SHA256 || after["type"] != "employee.certificate" || f.repo.events[0].EntityType != Entity {
		t.Errorf("event after = %v", after)
	}
}

func TestUploadRefuses(t *testing.T) {
	big := append(slices.Clone(pdf), make([]byte, vault.MaxUploadBytes)...)
	cases := []struct {
		name    string
		reader  Reader
		typeKey string
		details Details
		data    []byte
		want    error
	}{
		{"unknown type", manager, "employment.contract", certificate(LinkRef{vault.Employee, ana}), pdf, ErrInvalid},
		{"read only", reader, "employee.certificate", certificate(LinkRef{vault.Employee, ana}), pdf, ErrForbidden},
		{"no employee", manager, "employee.certificate", certificate(), pdf, ErrInvalid},
		{"kind not allowed", manager, "employee.certificate", certificate(LinkRef{vault.Employee, ana}, LinkRef{vault.Order, uuid.New()}), pdf, ErrInvalid},
		{"no title", manager, "other", Details{Title: " "}, pdf, ErrInvalid},
		{"bad date", manager, "other", Details{Title: "x", DocumentDate: ptr("24.11.2026")}, pdf, ErrInvalid},
		{"until before from", manager, "other", Details{Title: "x", ValidFrom: ptr("2026-02-01"), ValidUntil: ptr("2026-01-01")}, pdf, ErrInvalid},
		{"not a pdf", manager, "other", Details{Title: "x"}, []byte("hello"), ErrFileType},
		{"empty", manager, "other", Details{Title: "x"}, nil, ErrInvalid},
		{"too large", manager, "other", Details{Title: "x"}, big, ErrTooLarge},
		{"missing subject", manager, "other", Details{Title: "x", Links: []LinkRef{{vault.Employee, uuid.New()}}}, pdf, ErrSubjectNotFound},
		{"hidden subject", manager, "asset.document", Details{Title: "x", Links: []LinkRef{{vault.Asset, equipment}}}, pdf, ErrSubjectNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newFixture()
			_, err := f.svc.Upload(context.Background(), c.reader, c.typeKey, c.details, Upload{FileName: "a.pdf", Data: c.data})
			if !errors.Is(err, c.want) {
				t.Fatalf("err = %v, want %v", err, c.want)
			}
			if len(f.store.files) != 0 || len(f.repo.docs) != 0 {
				t.Errorf("kept something: %d files, %d documents", len(f.store.files), len(f.repo.docs))
			}
		})
	}
}

func TestUploadWithoutStorage(t *testing.T) {
	svc := NewService(newMemRepo(), stubSubjects{})
	if _, err := svc.Upload(context.Background(), manager, "other", Details{Title: "x"}, Upload{Data: pdf}); !errors.Is(err, ErrNoStorage) {
		t.Fatalf("err = %v", err)
	}
}

func ptr(s string) *string { return &s }

// equipmentReader may see equipment too.
var equipmentReader = Reader{ID: uuid.New(), Perms: []string{vault.PermRead, vault.PermManage, "equipment.read"}}

func TestALinksRequirementsHideTheDocument(t *testing.T) {
	f := newFixture()
	d, err := f.svc.Upload(context.Background(), equipmentReader, "asset.document",
		Details{Title: "Warranty", Links: []LinkRef{{vault.Asset, equipment}}}, Upload{FileName: "w.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(d.Requires, []string{"equipment.read", vault.PermRead}) {
		t.Fatalf("requires = %v", d.Requires)
	}
	if _, err := f.svc.Get(context.Background(), manager, d.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("a manager without equipment.read: %v", err)
	}
	if p, _ := f.svc.Search(context.Background(), manager, Query{}); p.Total != 0 {
		t.Errorf("search shows it: %+v", p)
	}
	if _, err := f.svc.Get(context.Background(), equipmentReader, d.ID); err != nil {
		t.Errorf("its reader: %v", err)
	}
}

func TestUpdateRecordsWhatChanged(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	company := uuid.New()
	f.subs[company] = SubjectInfo{Label: "UAB Statyba"}
	d, err := f.svc.Upload(ctx, manager, "employee.certificate", certificate(LinkRef{vault.Employee, ana}), Upload{FileName: "c.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	// The same again records nothing.
	if _, err := f.svc.Update(ctx, manager, d.ID, certificate(LinkRef{vault.Employee, ana})); err != nil {
		t.Fatal(err)
	}
	if got := f.repo.eventNames(); len(got) != 1 {
		t.Fatalf("an unchanged save recorded %v", got)
	}
	next, err := f.svc.Update(ctx, manager, d.ID, Details{
		Title: "Working at height (renewed)", ValidUntil: ptr("2028-01-31"),
		Links: []LinkRef{{vault.Employee, ana}, {vault.Company, company}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if next.Title != "Working at height (renewed)" || *next.ValidUntil != "2028-01-31" || len(next.Links) != 2 {
		t.Fatalf("updated = %+v", next)
	}
	if got := f.repo.eventNames(); !slices.Equal(got, []string{EventUploaded, EventUpdated, EventLinked}) {
		t.Fatalf("events = %v", got)
	}
	if _, err := f.svc.Update(ctx, manager, d.ID, certificate(LinkRef{vault.Company, company})); !errors.Is(err, ErrInvalid) {
		t.Errorf("dropping the required employee: %v", err)
	}
	if _, err := f.svc.Update(ctx, reader, d.ID, certificate(LinkRef{vault.Employee, ana})); !errors.Is(err, ErrForbidden) {
		t.Errorf("a reader: %v", err)
	}
}

func TestUpdateKeepsLockedLinks(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	d, err := f.svc.Upload(ctx, manager, "other", Details{Title: "x", Links: []LinkRef{{vault.Employee, ana}}}, Upload{FileName: "c.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	f.repo.mu.Lock()
	doc := f.repo.docs[d.ID]
	doc.Links[0].Locked = true
	f.repo.docs[d.ID] = doc
	f.repo.mu.Unlock()
	next, err := f.svc.Update(ctx, manager, d.ID, Details{Title: "y"})
	if err != nil {
		t.Fatal(err)
	}
	if len(next.Links) != 1 || next.Links[0].ID != ana {
		t.Fatalf("links = %+v", next.Links)
	}
}

func TestAddVersionAndOpen(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	d, err := f.svc.Upload(ctx, manager, "other", Details{Title: "x"}, Upload{FileName: "a.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	second := append(slices.Clone(pdf), []byte("% v2\n")...)
	d, err = f.svc.AddVersion(ctx, manager, d.ID, Upload{FileName: "b.pdf", Data: second, Note: "corrected"})
	if err != nil {
		t.Fatal(err)
	}
	if d.Current().Number != 2 || d.Current().Origin != VersionAdded || len(d.Versions) != 2 {
		t.Fatalf("versions = %+v", d.Versions)
	}
	file, data, err := f.svc.Open(ctx, reader, d.ID, 1)
	if err != nil || !bytes.Equal(data, pdf) || file.FileName != "a.pdf" {
		t.Fatalf("open v1 = %+v %q %v", file, data, err)
	}
	if _, _, err := f.svc.Open(ctx, reader, d.ID, 3); !errors.Is(err, ErrNotFound) {
		t.Errorf("v3: %v", err)
	}
	f.store.files[d.Current().File.ObjectKey] = []byte("%PDF-changed")
	if _, _, err := f.svc.Open(ctx, reader, d.ID, 2); !errors.Is(err, ErrDamaged) {
		t.Errorf("a changed file: %v", err)
	}
	if got := f.repo.eventNames(); !slices.Equal(got, []string{EventUploaded, EventVersionAdded}) {
		t.Errorf("events = %v", got)
	}
}

func TestRemove(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	d, err := f.svc.Upload(ctx, manager, "other", Details{Title: "x"}, Upload{FileName: "a.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Remove(ctx, reader, d.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a reader removed it: %v", err)
	}
	if err := f.svc.Remove(ctx, manager, d.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Get(ctx, manager, d.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("after removal: %v", err)
	}

	locked, err := f.svc.Upload(ctx, manager, "other", Details{Title: "x"}, Upload{FileName: "a.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	f.repo.mu.Lock()
	doc := f.repo.docs[locked.ID]
	doc.Locked = true
	f.repo.docs[locked.ID] = doc
	f.repo.mu.Unlock()
	if err := f.svc.Remove(ctx, manager, locked.ID); !errors.Is(err, ErrLocked) {
		t.Errorf("a locked document: %v", err)
	}
}

func TestRefreshLabels(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	if _, err := f.svc.Upload(ctx, manager, "other", Details{Title: "x", Links: []LinkRef{{vault.Employee, ana}}}, Upload{FileName: "a.pdf", Data: pdf}); err != nil {
		t.Fatal(err)
	}
	f.subs[ana] = SubjectInfo{Label: "Ana Petrauskienė"}
	n, err := f.svc.RefreshLabels(ctx)
	if err != nil || n != 1 {
		t.Fatalf("refreshed %d, %v", n, err)
	}
	delete(f.subs, ana)
	if n, err := f.svc.RefreshLabels(ctx); err != nil || n != 0 {
		t.Errorf("a gone subject: %d, %v", n, err)
	}
}

func TestTypesAreTheReadersOnly(t *testing.T) {
	svc := NewService(newMemRepo(), stubSubjects{})
	if got := svc.Types(Reader{Perms: []string{"equipment.read"}}); len(got) != 0 {
		t.Errorf("without vault.read: %v", got)
	}
	if got := svc.Types(reader); len(got) != 8 || slices.ContainsFunc(got, func(ty vault.Type) bool { return ty.Sealed }) {
		t.Errorf("with vault.read: %d types", len(got))
	}
	if got := svc.Types(Reader{Perms: []string{vault.PermRead, vault.PermEmploymentRead}}); len(got) != len(vault.Types()) {
		t.Errorf("with both: %d types", len(got))
	}
}

func TestTSQuery(t *testing.T) {
	for in, want := range map[string]string{
		"":                 "",
		"  Žukausk  sert ": "žukausk:* & sert:*",
		"a&b|!c:*'d":       "a:* & b:* & c:* & d:*",
		"EQ-0001":          "eq:* & 0001:*",
		"one two three four five six seven eight nine ten eleven": "one:* & two:* & three:* & four:* & five:* & six:* & seven:* & eight:* & nine:* & ten:*",
	} {
		if got := tsQuery(in); got != want {
			t.Errorf("tsQuery(%q) = %q, want %q", in, got, want)
		}
	}
}
