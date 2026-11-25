package document

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/vault"
)

func (m *memRepo) QueueArchives(_ context.Context, kind string, ids []uuid.UUID, _ time.Time) (int64, error) {
	missing, _ := m.Unarchived(context.Background(), kind, ids)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.archives = append(m.archives, missing...)
	return int64(len(missing)), nil
}

func (m *memRepo) Unarchived(_ context.Context, kind string, ids []uuid.UUID) ([]uuid.UUID, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []uuid.UUID{}
	for _, id := range ids {
		found := false
		for _, d := range m.docs {
			found = found || d.SourceKind != nil && *d.SourceKind == kind && *d.SourceID == id
		}
		if !found {
			out = append(out, id)
		}
	}
	return out, nil
}

// stubRecords answers the records it holds, and their hashes now.
type stubRecords struct {
	records map[uuid.UUID]Record
	hashes  map[uuid.UUID]string
	ended   map[uuid.UUID]string
	asked   int
}

func (s *stubRecords) Record(_ context.Context, source string, id uuid.UUID) (Record, error) {
	s.asked++
	r, ok := s.records[id]
	if !ok || source != vault.SourceAssignment {
		return Record{}, ErrNotFound
	}
	return r, nil
}

func (s *stubRecords) Ended(_ context.Context, _ string, id uuid.UUID) (string, bool, error) {
	day, ok := s.ended[id]
	return day, ok, nil
}

func (s *stubRecords) Hash(_ context.Context, _ string, id uuid.UUID) (string, error) {
	h, ok := s.hashes[id]
	if !ok {
		return "", ErrNotFound
	}
	return h, nil
}

const formHash = "3f2a9c3f2a9c3f2a9c3f2a9c3f2a9c3f2a9c3f2a9c3f2a9c3f2a9c3f2a9c0001"

// archiveFixture holds one equipment item's stored form, given by giver.
func archiveFixture() (fixture, *stubRecords, uuid.UUID, uuid.UUID) {
	f := newFixture()
	giver, assignment := uuid.New(), uuid.New()
	date, number := "2026-11-20", "EQ-0001"
	recs := &stubRecords{records: map[uuid.UUID]Record{assignment: {
		Title: "EQ-0001 · 2026-11-20", Number: &number, DocumentDate: &date,
		Links: []Link{
			{Kind: vault.Asset, ID: equipment, Label: "EQ-0001 Laptop", Requires: []string{"equipment.read"}},
			{Kind: vault.Employee, ID: ana, Label: "Ana Žukauskaitė"},
		},
		FileName: "assignment-form-EQ-0001-2026-11-20.pdf", PDF: pdf, DocumentHash: formHash, Actor: giver,
	}}, hashes: map[uuid.UUID]string{assignment: formHash}}
	WithRecords(recs)(f.svc)
	return f, recs, giver, assignment
}

// Archiving keeps the record's PDF once, as an archived document of its
// source's type, linked as the source names it (locked), under the giver,
// with an event of no actor; a second run, or one for a record with nothing
// to archive, changes nothing.
func TestArchiveKeepsTheRecordOnce(t *testing.T) {
	f, recs, giver, assignment := archiveFixture()
	ctx := context.Background()
	if err := f.svc.Archive(ctx, vault.SourceAssignment, assignment); err != nil {
		t.Fatal(err)
	}
	if len(f.repo.docs) != 1 || len(f.store.files) != 1 {
		t.Fatalf("%d documents, %d files", len(f.repo.docs), len(f.store.files))
	}
	var d Document
	for _, d = range f.repo.docs {
	}
	if d.Type != vault.AssignmentFormType || d.Origin != vault.Archived || d.Title != "EQ-0001 · 2026-11-20" || *d.Number != "EQ-0001" ||
		*d.DocumentDate != "2026-11-20" || *d.SourceKind != vault.SourceAssignment || *d.SourceID != assignment || d.CreatedByUserID != giver {
		t.Fatalf("document = %+v", d)
	}
	if !slices.Equal(d.Requires, []string{"equipment.read", vault.PermRead}) {
		t.Errorf("requires = %v", d.Requires)
	}
	if len(d.Links) != 2 || !d.Links[0].Locked || !d.Links[1].Locked {
		t.Errorf("links = %+v", d.Links)
	}
	v := d.Current()
	if v.Number != 1 || v.Origin != VersionArchived || v.DocumentHash != formHash || v.File.ContentType != "application/pdf" ||
		v.File.FileName != "assignment-form-EQ-0001-2026-11-20.pdf" || !strings.HasPrefix(v.File.ObjectKey, "vault/"+d.ID.String()+"/") {
		t.Errorf("version = %+v", v)
	}
	if got := f.repo.eventNames(); !slices.Equal(got, []string{EventArchived}) {
		t.Fatalf("events = %v", got)
	}
	ev := f.repo.events[0]
	var after map[string]any
	_ = json.Unmarshal(ev.After, &after)
	if ev.ActorUserID != nil || after["sha256"] != formHash || after["source_id"] != assignment.String() || after["type"] != vault.AssignmentFormType {
		t.Errorf("event = %+v %v", ev, after)
	}

	asked := recs.asked
	if err := f.svc.Archive(ctx, vault.SourceAssignment, assignment); err != nil {
		t.Fatal(err)
	}
	if recs.asked != asked || len(f.repo.docs) != 1 || len(f.store.files) != 1 || len(f.repo.events) != 1 {
		t.Errorf("a second run changed something: asked %d, %d documents, %d files", recs.asked-asked, len(f.repo.docs), len(f.store.files))
	}
	if err := f.svc.Archive(ctx, vault.SourceAssignment, uuid.New()); err != nil {
		t.Errorf("a record with nothing to archive: %v", err)
	}
	if len(f.repo.docs) != 1 {
		t.Error("a record with nothing to archive was archived")
	}
}

// What is not a PDF, has no hash or misses a required link is refused for
// good; an unknown source is an error.
func TestArchiveRefuses(t *testing.T) {
	ctx := context.Background()
	for name, change := range map[string]func(*Record){
		"not a PDF":   func(r *Record) { r.PDF = []byte("hello") },
		"no hash":     func(r *Record) { r.DocumentHash = "" },
		"no employee": func(r *Record) { r.Links = r.Links[:1] },
		"no title":    func(r *Record) { r.Title = " " },
		"no actor":    func(r *Record) { r.Actor = uuid.Nil },
	} {
		f, recs, _, assignment := archiveFixture()
		r := recs.records[assignment]
		change(&r)
		recs.records[assignment] = r
		if err := f.svc.Archive(ctx, vault.SourceAssignment, assignment); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v, want ErrInvalid", name, err)
		}
		if len(f.repo.docs) != 0 || len(f.store.files) != 0 {
			t.Errorf("%s: something was kept", name)
		}
	}
	f, _, _, assignment := archiveFixture()
	if err := f.svc.Archive(ctx, "nothing", assignment); err == nil {
		t.Error("an unknown source archived")
	}
	if err := f.svc.Archive(ctx, vault.SourceSignedForm, assignment); err == nil {
		t.Error("signed copies are not archived")
	}
}

// Queueing asks only for the records with no document yet.
func TestQueueArchives(t *testing.T) {
	f, _, _, assignment := archiveFixture()
	ctx := context.Background()
	if err := f.svc.Archive(ctx, vault.SourceAssignment, assignment); err != nil {
		t.Fatal(err)
	}
	other := uuid.New()
	n, err := f.svc.QueueArchives(ctx, vault.AssignmentFormType, []uuid.UUID{assignment, other})
	if err != nil || n != 1 || !slices.Equal(f.repo.archives, []uuid.UUID{other}) {
		t.Errorf("queued %d %v, %v", n, f.repo.archives, err)
	}
	if got, _ := f.svc.Unarchived(ctx, vault.AssignmentFormType, []uuid.UUID{assignment, other}); !slices.Equal(got, []uuid.UUID{other}) {
		t.Errorf("unarchived = %v", got)
	}
	if _, err := f.svc.QueueArchives(ctx, vault.SignedFormType, []uuid.UUID{other}); err == nil {
		t.Error("signed copies queued for archiving")
	}
	if _, err := f.svc.QueueArchives(ctx, "employee.certificate", []uuid.UUID{other}); err == nil {
		t.Error("certificates queued for archiving")
	}
}

// Verify compares the archived hash with the source's, hashed again, and the
// file with its own hash.
func TestVerify(t *testing.T) {
	f, recs, _, assignment := archiveFixture()
	ctx := context.Background()
	if err := f.svc.Archive(ctx, vault.SourceAssignment, assignment); err != nil {
		t.Fatal(err)
	}
	var d Document
	for _, d = range f.repo.docs {
	}
	equipmentReader := Reader{ID: uuid.New(), Perms: []string{vault.PermRead, "equipment.read"}}
	got, err := f.svc.Verify(ctx, equipmentReader, d.ID)
	if err != nil || !got.Matches || !got.FileIntact || got.SourceGone || got.SourceHash != formHash || got.DocumentHash != formHash {
		t.Fatalf("verify = %+v, %v", got, err)
	}
	// Without the asset's permission the document is not there.
	if _, err := f.svc.Verify(ctx, reader, d.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("without equipment.read: %v", err)
	}
	// A changed snapshot, a changed file, a record gone.
	recs.hashes[assignment] = strings.Repeat("0", 64)
	key := d.Current().File.ObjectKey
	f.store.files[key] = append([]byte(nil), pdf[:len(pdf)-1]...)
	got, err = f.svc.Verify(ctx, equipmentReader, d.ID)
	if err != nil || got.Matches || got.FileIntact || got.SourceGone {
		t.Errorf("after changes = %+v, %v", got, err)
	}
	delete(recs.hashes, assignment)
	delete(f.store.files, key)
	got, err = f.svc.Verify(ctx, equipmentReader, d.ID)
	if err != nil || got.Matches || got.FileIntact || !got.SourceGone {
		t.Errorf("record and file gone = %+v, %v", got, err)
	}
	// An uploaded document has nothing to verify against.
	up, err := f.svc.Upload(ctx, manager, "employee.certificate", certificate(LinkRef{vault.Employee, ana}), Upload{FileName: "c.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Verify(ctx, manager, up.ID); !errors.Is(err, ErrInvalid) {
		t.Errorf("verify an upload: %v, want ErrInvalid", err)
	}
}

// No one adds, changes or removes an archived document here.
func TestArchivedTypesAreReadOnly(t *testing.T) {
	for _, key := range []string{vault.AssignmentFormType, vault.OrderRecordType} {
		ty, ok := vault.TypeOf(key)
		if !ok || ty.Manage != "" || ty.Source == "" || !ty.Allows(vault.Archived) || ty.Allows(vault.Uploaded) {
			t.Errorf("%s = %+v", key, ty)
		}
	}
	f, _, _, assignment := archiveFixture()
	ctx := context.Background()
	if err := f.svc.Archive(ctx, vault.SourceAssignment, assignment); err != nil {
		t.Fatal(err)
	}
	var d Document
	for _, d = range f.repo.docs {
	}
	all := Reader{ID: uuid.New(), Perms: []string{vault.PermRead, vault.PermManage, "equipment.read"}}
	if _, err := f.svc.Upload(ctx, all, vault.AssignmentFormType, Details{Title: "x", Links: []LinkRef{{vault.Asset, equipment}, {vault.Employee, ana}}},
		Upload{FileName: "x.pdf", Data: pdf}); err == nil {
		t.Error("an archived type was uploaded")
	}
	if err := f.svc.Remove(ctx, all, d.ID); err == nil {
		t.Error("an archived document was removed")
	}
	if _, err := f.svc.AddVersion(ctx, all, d.ID, Upload{FileName: "x.pdf", Data: pdf}); err == nil {
		t.Error("an archived document took a version")
	}
}
