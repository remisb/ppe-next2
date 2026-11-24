package document

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/sealbox"
	"github.com/remisb/ppe-next2/internal/vault"
)

// clerk holds the employment documents' permissions.
var clerk = Reader{ID: uuid.New(), Perms: []string{vault.PermEmploymentRead, vault.PermEmploymentManage}}

// stubEmployments says who has stopped working, and when.
type stubEmployments map[uuid.UUID]string

func (s stubEmployments) EmploymentEnded(_ context.Context, e uuid.UUID) (bool, string, error) {
	on, ok := s[e]
	return ok, on, nil
}

type sealedFixture struct {
	fixture
	ended stubEmployments
	day   time.Time
}

func newSealedFixture(t *testing.T) *sealedFixture {
	t.Helper()
	master, err := sealbox.NewKeyring(1, map[int16][]byte{1: bytes.Repeat([]byte{9}, sealbox.KeySize)})
	if err != nil {
		t.Fatal(err)
	}
	f := &sealedFixture{fixture: newFixture(), ended: stubEmployments{}, day: time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC)}
	f.svc = NewService(f.repo, f.subs, WithFiles(f.store), WithKeys(master), WithEmployments(f.ended),
		WithClock(func() time.Time { return f.day }))
	return f
}

func contract(f *sealedFixture, t *testing.T) Document {
	t.Helper()
	d, err := f.svc.Upload(context.Background(), clerk, "employment.contract",
		Details{Title: "Darbo sutartis Nr. 12", Links: []LinkRef{{vault.Employee, ana}}},
		Upload{FileName: "Ana sutartis.pdf", Data: pdf, Note: "salary 2400"})
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestSealedUploadSealsWhatNamesIt(t *testing.T) {
	f := newSealedFixture(t)
	d := contract(f, t)
	// The answer reads as the document is; the stored row and file do not.
	if d.Title != "Darbo sutartis Nr. 12" || d.Current().Note != "salary 2400" || d.Current().File.FileName != "Ana sutartis.pdf" || !d.Sealed {
		t.Fatalf("answer = %+v / %+v", d, d.Current())
	}
	stored := f.repo.docs[d.ID]
	v := stored.Versions[0]
	if stored.Title != "" || len(stored.TitleSealed) == 0 || len(stored.Key) == 0 || v.Note != "" || v.File.FileName != "document.pdf" || !v.File.Sealed {
		t.Fatalf("stored = %q %+v", stored.Title, v)
	}
	if obj := f.store.files[v.File.ObjectKey]; bytes.Contains(obj, []byte("%PDF")) || len(obj) == 0 {
		t.Errorf("the file is stored in the clear")
	}
	// No title, name or note in the event.
	raw, _ := json.Marshal(f.repo.events)
	for _, secret := range []string{"Darbo sutartis", "Ana sutartis", "salary"} {
		if strings.Contains(string(raw), secret) {
			t.Errorf("the event holds %q", secret)
		}
	}
	if !slices.Equal(stored.Requires, []string{vault.PermEmploymentRead}) {
		t.Errorf("requires = %v", stored.Requires)
	}
	// Someone with vault.read alone does not see it.
	if _, err := f.svc.Get(context.Background(), manager, d.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("vault.read alone: %v", err)
	}
}

func TestSealedWithoutKeys(t *testing.T) {
	f := newFixture()
	_, err := f.svc.Upload(context.Background(), clerk, "employment.contract",
		Details{Title: "x", Links: []LinkRef{{vault.Employee, ana}}}, Upload{FileName: "a.pdf", Data: pdf})
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v", err)
	}
}

func TestSealedOpenRecordsFirst(t *testing.T) {
	f := newSealedFixture(t)
	ctx := context.Background()
	d := contract(f, t)
	if _, _, err := f.svc.Open(ctx, clerk, d.ID, 1); !errors.Is(err, ErrSealed) {
		t.Fatalf("plain open: %v", err)
	}
	file, data, err := f.svc.OpenSealed(ctx, clerk, d.ID, 1)
	if err != nil || !bytes.Equal(data, pdf) || file.FileName != "Ana sutartis.pdf" {
		t.Fatalf("open = %+v %q %v", file, data, err)
	}
	if got := f.repo.eventNames(); got[len(got)-1] != EventOpened {
		t.Errorf("events = %v", got)
	}
	// A changed stored file does not open.
	f.store.files[d.Current().File.ObjectKey] = []byte("not sealed")
	if _, _, err := f.svc.OpenSealed(ctx, clerk, d.ID, 1); !errors.Is(err, ErrDamaged) {
		t.Errorf("changed file: %v", err)
	}
}

func TestSealedEditAndVersion(t *testing.T) {
	f := newSealedFixture(t)
	ctx := context.Background()
	d := contract(f, t)
	next, err := f.svc.Update(ctx, clerk, d.ID, Details{Title: "Darbo sutartis Nr. 13", Links: []LinkRef{{vault.Employee, ana}}})
	if err != nil || next.Title != "Darbo sutartis Nr. 13" || f.repo.docs[d.ID].Title != "" {
		t.Fatalf("update = %q %v", next.Title, err)
	}
	last := f.repo.events[len(f.repo.events)-1]
	if strings.Contains(string(last.After), "Nr. 13") || !strings.Contains(string(last.After), "title_changed") {
		t.Errorf("update event = %s", last.After)
	}
	next, err = f.svc.AddVersion(ctx, clerk, d.ID, Upload{FileName: "signed.pdf", Data: append(slices.Clone(pdf), '\n'), Note: "signed"})
	if err != nil || next.Current().File.FileName != "signed.pdf" || next.Current().Note != "signed" {
		t.Fatalf("add version = %+v %v", next.Current(), err)
	}
	if _, data, err := f.svc.OpenSealed(ctx, clerk, d.ID, 2); err != nil || !bytes.HasSuffix(data, []byte("\n")) {
		t.Errorf("open v2 = %v", err)
	}
}

func TestRetentionShredsWhatIsDue(t *testing.T) {
	f := newSealedFixture(t)
	ctx := context.Background()
	d := contract(f, t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	// Still employed: kept, no day known.
	if res, err := f.svc.ShredDue(ctx, logger); err != nil || res.Documents != 0 || f.repo.docs[d.ID].RetainUntil != nil {
		t.Fatalf("employed: %+v %v %v", res, err, f.repo.docs[d.ID].RetainUntil)
	}
	// Employment ended: kept 120 months after.
	f.ended[ana] = "2026-01-31"
	if res, err := f.svc.ShredDue(ctx, logger); err != nil || res.Documents != 0 {
		t.Fatalf("ended: %+v %v", res, err)
	}
	if got := f.repo.docs[d.ID].RetainUntil; got == nil || *got != "2036-01-31" {
		t.Fatalf("retain until = %v", got)
	}
	// Held past the day: kept; the hold lapses, then it goes.
	f.day = time.Date(2036, 2, 1, 10, 0, 0, 0, time.UTC)
	if _, err := f.svc.SetHold(ctx, clerk, d.ID, ptr("2036-03-01"), "Court case 2-123/2035"); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Remove(ctx, clerk, d.ID); !errors.Is(err, ErrHeld) {
		t.Errorf("remove while held: %v", err)
	}
	if res, _ := f.svc.ShredDue(ctx, logger); res.Documents != 0 {
		t.Fatalf("shredded while held")
	}
	f.day = time.Date(2036, 3, 2, 10, 0, 0, 0, time.UTC)
	key := f.repo.docs[d.ID].Versions[0].File.ObjectKey
	if res, err := f.svc.ShredDue(ctx, logger); err != nil || res.Documents != 1 {
		t.Fatalf("due: %+v %v", res, err)
	}
	if _, ok := f.store.files[key]; ok {
		t.Error("the file is still stored")
	}
	if got := f.repo.eventNames(); got[len(got)-1] != EventShredded || f.repo.events[len(f.repo.events)-1].ActorUserID != nil {
		t.Errorf("events = %v", got)
	}
}

func TestRemovedSealedIsShredded(t *testing.T) {
	f := newSealedFixture(t)
	ctx := context.Background()
	d := contract(f, t)
	if err := f.svc.Remove(ctx, clerk, d.ID); err != nil {
		t.Fatal(err)
	}
	if res, err := f.svc.ShredDue(ctx, slog.New(slog.NewTextHandler(io.Discard, nil))); err != nil || res.Documents != 1 {
		t.Fatalf("removed: %+v %v", res, err)
	}
}

func TestHoldRules(t *testing.T) {
	f := newSealedFixture(t)
	ctx := context.Background()
	d := contract(f, t)
	for _, c := range []struct {
		until  *string
		reason string
	}{{ptr("2026-11-23"), "x"}, {ptr("2027-01-01"), " "}, {ptr("1.1.2027"), "x"}} {
		if _, err := f.svc.SetHold(ctx, clerk, d.ID, c.until, c.reason); !errors.Is(err, ErrInvalid) {
			t.Errorf("%v %q: %v", *c.until, c.reason, err)
		}
	}
	if _, err := f.svc.SetHold(ctx, Reader{ID: uuid.New(), Perms: []string{vault.PermEmploymentRead}}, d.ID, ptr("2027-01-01"), "x"); !errors.Is(err, ErrForbidden) {
		t.Errorf("a reader: %v", err)
	}
	held, err := f.svc.SetHold(ctx, clerk, d.ID, ptr("2027-01-01"), "Audit")
	if err != nil || *held.HoldUntil != "2027-01-01" {
		t.Fatalf("hold = %v %v", held.HoldUntil, err)
	}
	cleared, err := f.svc.SetHold(ctx, clerk, d.ID, nil, "")
	if err != nil || cleared.HoldUntil != nil {
		t.Fatalf("clear = %v %v", cleared.HoldUntil, err)
	}
	got := f.repo.eventNames()
	if !slices.Contains(got, EventHoldSet) || got[len(got)-1] != EventHoldCleared {
		t.Errorf("events = %v", got)
	}
}
