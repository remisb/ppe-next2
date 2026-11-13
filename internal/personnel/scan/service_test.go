package scan

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"slices"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/personnel/document"
	"github.com/remisb/ppe-next2/internal/sealbox"
)

var today = time.Date(2026, 11, 13, 9, 0, 0, 0, time.UTC)

// fakeRepo keeps rows and events in memory.
type fakeRepo struct {
	mu     sync.Mutex
	rows   map[uuid.UUID]Record
	events []audit.Event
	fail   error
}

func newFakeRepo() *fakeRepo { return &fakeRepo{rows: map[uuid.UUID]Record{}} }

func (r *fakeRepo) Insert(_ context.Context, rec Record, events []audit.Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail != nil {
		return r.fail
	}
	r.rows[rec.ID] = rec
	r.events = append(r.events, events...)
	return nil
}

func (r *fakeRepo) Live(_ context.Context, owner uuid.UUID, now time.Time) ([]Record, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []Record{}
	for _, rec := range r.rows {
		if rec.CreatedBy == owner && rec.ExpiresAt.After(now) {
			out = append(out, rec)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (r *fakeRepo) Get(_ context.Context, id, owner uuid.UUID, now time.Time) (Record, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	rec, ok := r.rows[id]
	if !ok || rec.CreatedBy != owner || !rec.ExpiresAt.After(now) {
		return Record{}, ErrNotFound
	}
	return rec, nil
}

func (r *fakeRepo) Record(_ context.Context, events []audit.Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, events...)
	return nil
}

func (r *fakeRepo) Delete(ctx context.Context, id, owner uuid.UUID, now time.Time, events func(Record) ([]audit.Event, error)) (Record, error) {
	rec, err := r.Get(ctx, id, owner, now)
	if err != nil {
		return Record{}, err
	}
	evs, err := events(rec)
	if err != nil {
		return Record{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.rows, id)
	r.events = append(r.events, evs...)
	return rec, nil
}

func (r *fakeRepo) DeleteExpired(_ context.Context, now time.Time) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var keys []string
	for id, rec := range r.rows {
		if !rec.ExpiresAt.After(now) {
			keys = append(keys, rec.ObjectKey)
			delete(r.rows, id)
		}
	}
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

func testKeys(t *testing.T) document.Keys {
	t.Helper()
	master, err := sealbox.NewKeyring(1, map[int16][]byte{1: bytes.Repeat([]byte{7}, sealbox.KeySize)})
	if err != nil {
		t.Fatal(err)
	}
	return document.Keys{Master: master, Index: bytes.Repeat([]byte{9}, sealbox.KeySize)}
}

func jpegOf(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h)), nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// clock is a settable clock for the tests.
type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func newTestService(t *testing.T) (*Service, *fakeRepo, *fakeStore, *clock) {
	t.Helper()
	repo, store, c := newFakeRepo(), &fakeStore{objects: map[string][]byte{}}, &clock{t: today}
	return NewService(repo, testKeys(t), store, WithClock(c.now)), repo, store, c
}

var jonas = Meta{Surname: "Pavyzdys", GivenNames: "Jonas", Kind: Passport, Number: "91234567"}

func TestKeepListOpenRemove(t *testing.T) {
	svc, repo, store, _ := newTestService(t)
	ctx := context.Background()
	me, other := uuid.New(), uuid.New()
	pages := [][]byte{jpegOf(t, 40, 30), jpegOf(t, 30, 40)}

	kept, err := svc.Keep(ctx, jonas, pages, me)
	if err != nil {
		t.Fatal(err)
	}
	if kept.FileName != "Pavyzdys_Jonas_passport.zip" || kept.Pages != 2 || !kept.ExpiresAt.Equal(today.AddDate(0, 0, 3)) {
		t.Errorf("kept = %+v", kept)
	}
	obj, ok := store.objects["personnel-scans/"+kept.ID.String()]
	if !ok {
		t.Fatalf("no object; store has %v", store.objects)
	}
	if bytes.Contains(obj, pages[0][:64]) || bytes.Contains(obj, []byte("page-01")) {
		t.Error("the object is not sealed")
	}
	rec := repo.rows[kept.ID]
	if bytes.Contains(rec.SealedMeta, []byte("Pavyzdys")) {
		t.Error("the meta is not sealed")
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventKept || repo.events[0].EntityID != kept.ID ||
		bytes.Contains(repo.events[0].After, []byte("Pavyzdys")) || bytes.Contains(repo.events[0].After, []byte("9123")) {
		t.Errorf("events = %+v", repo.events)
	}

	list, err := svc.List(ctx, me)
	if err != nil || len(list) != 1 || list[0] != kept {
		t.Fatalf("List = %+v, %v; want the kept scan", list, err)
	}
	if theirs, err := svc.List(ctx, other); err != nil || len(theirs) != 0 || theirs == nil {
		t.Errorf("another user's List = %#v, %v; want []", theirs, err)
	}

	if _, err := svc.Open(ctx, kept.ID, other); !errors.Is(err, ErrNotFound) {
		t.Errorf("another user's Open: %v, want ErrNotFound", err)
	}
	a, err := svc.Open(ctx, kept.ID, me)
	if err != nil {
		t.Fatal(err)
	}
	if a.FileName != kept.FileName {
		t.Errorf("file name %q", a.FileName)
	}
	checkZip(t, a.Zip, pages)
	if last := repo.events[len(repo.events)-1]; last.Event != EventDownloaded || last.EntityID != kept.ID {
		t.Errorf("download event = %+v", last)
	}

	if err := svc.Remove(ctx, kept.ID, other); !errors.Is(err, ErrNotFound) {
		t.Errorf("another user's Remove: %v", err)
	}
	if err := svc.Remove(ctx, kept.ID, me); err != nil {
		t.Fatal(err)
	}
	if len(repo.rows) != 0 || len(store.objects) != 0 {
		t.Errorf("after Remove: rows %d, objects %d", len(repo.rows), len(store.objects))
	}
	if last := repo.events[len(repo.events)-1]; last.Event != EventRemoved {
		t.Errorf("remove event = %+v", last)
	}
	if _, err := svc.Open(ctx, kept.ID, me); !errors.Is(err, ErrNotFound) {
		t.Errorf("Open after Remove: %v", err)
	}
}

// checkZip checks a holds page-01.jpg … stored, each the page sent.
func checkZip(t *testing.T, a []byte, pages [][]byte) {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(a), int64(len(a)))
	if err != nil {
		t.Fatal(err)
	}
	if len(zr.File) != len(pages) {
		t.Fatalf("zip has %d files, want %d", len(zr.File), len(pages))
	}
	for i, f := range zr.File {
		if want := []string{"page-01.jpg", "page-02.jpg"}[i]; f.Name != want || f.Method != zip.Store {
			t.Errorf("file %d = %s (method %d), want %s stored", i, f.Name, f.Method, want)
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		if !bytes.Equal(b, pages[i]) {
			t.Errorf("%s differs from the page sent", f.Name)
		}
	}
}

func TestExpiredScansAreHiddenAndPurged(t *testing.T) {
	svc, repo, store, c := newTestService(t)
	ctx := context.Background()
	me := uuid.New()
	old, err := svc.Keep(ctx, jonas, [][]byte{jpegOf(t, 10, 10)}, me)
	if err != nil {
		t.Fatal(err)
	}
	c.t = today.Add(48 * time.Hour)
	fresh, err := svc.Keep(ctx, jonas, [][]byte{jpegOf(t, 10, 10)}, me)
	if err != nil {
		t.Fatal(err)
	}
	c.t = today.Add(72 * time.Hour) // the first has just expired
	list, err := svc.List(ctx, me)
	if err != nil || len(list) != 1 || list[0].ID != fresh.ID {
		t.Fatalf("List = %+v, %v; want the fresh one only", list, err)
	}
	if _, err := svc.Open(ctx, old.ID, me); !errors.Is(err, ErrNotFound) {
		t.Errorf("Open of an expired scan: %v", err)
	}
	if err := svc.Remove(ctx, old.ID, me); !errors.Is(err, ErrNotFound) {
		t.Errorf("Remove of an expired scan: %v", err)
	}
	n, err := svc.PurgeExpired(ctx, slog.New(slog.DiscardHandler))
	if err != nil || n != 1 {
		t.Fatalf("PurgeExpired = %d, %v; want 1", n, err)
	}
	if _, ok := repo.rows[old.ID]; ok {
		t.Error("the expired row is still there")
	}
	if _, ok := store.objects[objectKey(old.ID)]; ok {
		t.Error("the expired object is still there")
	}
	if _, ok := store.objects[objectKey(fresh.ID)]; !ok {
		t.Error("the fresh object went too")
	}
}

func TestKeepRefuses(t *testing.T) {
	svc, repo, store, _ := newTestService(t)
	ctx := context.Background()
	me := uuid.New()
	page := jpegOf(t, 10, 10)
	var pngPage bytes.Buffer
	if err := png.Encode(&pngPage, image.NewRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	eleven := make([][]byte, MaxPages+1)
	for i := range eleven {
		eleven[i] = page
	}
	huge := append(slices.Clone(page), make([]byte, document.MaxCopySize)...)
	for name, tc := range map[string]struct {
		meta  Meta
		pages [][]byte
		want  error
	}{
		"no pages":       {jonas, nil, ErrInvalid},
		"eleven pages":   {jonas, eleven, ErrTooManyPages},
		"a PNG":          {jonas, [][]byte{page, pngPage.Bytes()}, ErrPageNotJPEG},
		"too wide":       {jonas, [][]byte{jpegOf(t, document.MaxCopySide+1, 10)}, ErrPageNotJPEG},
		"over 5 MB":      {jonas, [][]byte{huge}, ErrPageTooLarge},
		"no kind":        {Meta{Surname: "A"}, [][]byte{page}, ErrInvalid},
		"no surname":     {Meta{Kind: IDCard}, [][]byte{page}, ErrInvalid},
		"only symbols":   {Meta{Surname: "../", Kind: IDCard}, [][]byte{page}, ErrInvalid},
		"bad number":     {Meta{Surname: "A", Kind: IDCard, Number: "12/34"}, [][]byte{page}, ErrInvalid},
		"not an MRZ":     {Meta{Surname: "A", Kind: Passport, MRZ: []string{"HELLO", "WORLD"}}, [][]byte{page}, ErrInvalid},
		"kind not MRZ's": {Meta{Surname: "A", Kind: IDCard, MRZ: passportMRZ}, [][]byte{page}, ErrInvalid},
	} {
		if _, err := svc.Keep(ctx, tc.meta, tc.pages, me); !errors.Is(err, tc.want) {
			t.Errorf("%s: %v, want %v", name, err, tc.want)
		}
	}
	if len(repo.rows) != 0 || len(store.objects) != 0 || len(repo.events) != 0 {
		t.Errorf("a refused Keep wrote: rows %d, objects %d, events %d", len(repo.rows), len(store.objects), len(repo.events))
	}
	// A passport's MRZ with a passport is kept.
	if _, err := svc.Keep(ctx, Meta{Surname: "Pavyzdys", Kind: Passport, MRZ: passportMRZ}, [][]byte{page}, me); err != nil {
		t.Errorf("a passport with its MRZ: %v", err)
	}
}

// passportMRZ is the shared vectors' Lithuanian passport.
var passportMRZ = []string{
	"P<LTUPAVYZDYS<<JONAS<<<<<<<<<<<<<<<<<<<<<<<<",
	"91234567<9LTU3309243M310515733309240064<<<42",
}

func TestKeepDeletesTheObjectWhenTheRowFails(t *testing.T) {
	svc, repo, store, _ := newTestService(t)
	repo.fail = ErrActorNotFound
	if _, err := svc.Keep(context.Background(), jonas, [][]byte{jpegOf(t, 10, 10)}, uuid.New()); !errors.Is(err, ErrActorNotFound) {
		t.Fatalf("Keep: %v", err)
	}
	if len(store.objects) != 0 {
		t.Errorf("the object was left: %v", store.objects)
	}
}

func TestNotConfigured(t *testing.T) {
	svc := NewService(newFakeRepo(), document.Keys{}, &fakeStore{objects: map[string][]byte{}})
	ctx := context.Background()
	if _, err := svc.Keep(ctx, jonas, [][]byte{jpegOf(t, 10, 10)}, uuid.New()); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("Keep: %v", err)
	}
	if _, err := svc.List(ctx, uuid.New()); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("List: %v", err)
	}
	svc = NewService(newFakeRepo(), testKeys(t), nil)
	if _, err := svc.Open(ctx, uuid.New(), uuid.New()); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("Open without a store: %v", err)
	}
}

func TestOpenRefusesAChangedObject(t *testing.T) {
	svc, _, store, _ := newTestService(t)
	ctx := context.Background()
	me := uuid.New()
	kept, err := svc.Keep(ctx, jonas, [][]byte{jpegOf(t, 10, 10)}, me)
	if err != nil {
		t.Fatal(err)
	}
	store.objects[objectKey(kept.ID)][40] ^= 1
	if _, err := svc.Open(ctx, kept.ID, me); !errors.Is(err, ErrUnopenable) {
		t.Errorf("Open of a changed object: %v, want ErrUnopenable", err)
	}
}

func TestKeepDays(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo, testKeys(t), &fakeStore{objects: map[string][]byte{}}, WithClock(func() time.Time { return today }), WithDays(7))
	kept, err := svc.Keep(context.Background(), jonas, [][]byte{jpegOf(t, 10, 10)}, uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if !kept.ExpiresAt.Equal(today.AddDate(0, 0, 7)) {
		t.Errorf("expires %v", kept.ExpiresAt)
	}
}

func TestFileName(t *testing.T) {
	for _, tc := range []struct {
		meta Meta
		want string
	}{
		{Meta{Surname: "Jonaitis", GivenNames: "Jonas", Kind: Passport}, "Jonaitis_Jonas_passport.zip"},
		{Meta{Surname: "VAN DER BERG", GivenNames: "ANNA MARIA", Kind: IDCard}, "VAN_DER_BERG_ANNA_MARIA_id-card.zip"},
		{Meta{Surname: "Žemaitė", Kind: ResidencePermit}, "Žemaitė_residence-permit.zip"},
		{Meta{Surname: `O'Brien/"x"`, GivenNames: "  Seán  ", Kind: Passport}, "OBrienx_Seán_passport.zip"},
		{Meta{Surname: "Smith-Jones", GivenNames: "_", Kind: Passport}, "Smith-Jones_passport.zip"},
	} {
		m := tc.meta
		m.Normalize()
		if got := m.FileName(); got != tc.want {
			t.Errorf("%+v: %q, want %q", tc.meta, got, tc.want)
		}
	}
}

func TestBuildZipIsTheSameForTheSamePages(t *testing.T) {
	pages := [][]byte{jpegOf(t, 10, 10), jpegOf(t, 12, 10)}
	a, err := buildZip(pages)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := buildZip(pages)
	if !bytes.Equal(a, b) {
		t.Error("two zips of the same pages differ")
	}
	checkZip(t, a, pages)
}
