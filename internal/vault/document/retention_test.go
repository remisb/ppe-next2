package document

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/vault"
)

// The types' periods are Lithuania's minimums (VAD): contracts, annexes and
// NDAs 50 years after employment; personal file papers 3; accounting and
// asset papers 10; PPE issuance records 1 after the items' service.
func TestRetentionPeriods(t *testing.T) {
	want := map[string]vault.Retention{
		"employee.certificate":   {Rule: vault.AfterEmploymentEnd, Months: 36},
		"employee.training":      {Rule: vault.AfterEmploymentEnd, Months: 36},
		"invoice":                {Rule: vault.AfterDocDate, Months: 120},
		"asset.document":         {Rule: vault.AfterDocDate, Months: 120},
		"other":                  {Rule: vault.Keep},
		vault.SignedFormType:     {Rule: vault.AfterSourceEnds, Months: 120},
		vault.AssignmentFormType: {Rule: vault.AfterSourceEnds, Months: 120},
		vault.OrderRecordType:    {Rule: vault.AfterSourceEnds, Months: 12},
		"employment.contract":    {Rule: vault.AfterEmploymentEnd, Months: 600},
		"employment.annex":       {Rule: vault.AfterEmploymentEnd, Months: 600},
		"employment.nda":         {Rule: vault.AfterEmploymentEnd, Months: 600},
		"employment.other":       {Rule: vault.AfterEmploymentEnd, Months: 36},
	}
	for _, ty := range vault.Types() {
		if got, ok := want[ty.Key]; !ok || ty.Retention != got {
			t.Errorf("%s retention = %+v, want %+v", ty.Key, ty.Retention, got)
		}
	}
}

// Periods count from 1 January of the year after the rule's day.
func TestRetainFrom(t *testing.T) {
	for day, want := range map[string]string{"2026-01-31": "2027-01-01", "2026-12-31": "2027-01-01", "2027-01-01": "2028-01-01"} {
		got, err := retainFrom(day)
		if err != nil || got.Format(time.DateOnly) != want {
			t.Errorf("retainFrom(%s) = %v %v, want %s", day, got, err, want)
		}
	}
}

// Documents that are not sealed are shredded on their day too: an invoice 10
// years after its date, a certificate 3 after employment, an archived record
// once its source ended; a removed one waits for its day; a Legal Hold stops
// it; a type kept until removed never goes.
func TestRetentionOfTypesNotSealed(t *testing.T) {
	f := newSealedFixture(t)
	ctx := context.Background()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	upload := func(key, title string, date *string, links ...LinkRef) Document {
		t.Helper()
		d, err := f.svc.Upload(ctx, manager, key, Details{Title: title, DocumentDate: date, Links: links}, Upload{FileName: "x.pdf", Data: pdf})
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	old := upload("invoice", "Invoice 2015", ptr("2015-06-01"))    // due 2026-01-01
	recent := upload("invoice", "Invoice 2020", ptr("2020-06-01")) // due 2031-01-01
	cert := upload("employee.certificate", "Heights", nil, LinkRef{vault.Employee, ana})
	other := upload("other", "Notes", ptr("2001-01-01"))
	removed := upload("invoice", "Invoice 2019", ptr("2019-03-01"))
	if err := f.svc.Remove(ctx, manager, removed.ID); err != nil {
		t.Fatal(err)
	}

	// An archived record whose assignment was returned in 2014.
	recs := &stubRecords{records: map[uuid.UUID]Record{}, hashes: map[uuid.UUID]string{}, ended: map[uuid.UUID]string{}}
	WithRecords(recs)(f.svc)
	assignment := uuid.New()
	date := "2014-02-01"
	recs.records[assignment] = Record{Title: "EQ-0001 · 2014-02-01", DocumentDate: &date,
		Links:    []Link{{Kind: vault.Asset, ID: equipment, Label: "EQ-0001"}, {Kind: vault.Employee, ID: ana, Label: "Ana"}},
		FileName: "f.pdf", PDF: pdf, DocumentHash: formHash, Actor: uuid.New()}
	if err := f.svc.Archive(ctx, vault.SourceAssignment, assignment); err != nil {
		t.Fatal(err)
	}
	var form uuid.UUID
	for id, d := range f.repo.docs {
		if d.Type == vault.AssignmentFormType {
			form = id
		}
	}

	if res, err := f.svc.ShredDue(ctx, logger); err != nil || res.Documents != 1 {
		t.Fatalf("first run: %+v %v", res, err)
	}
	if !slices.Equal(f.repo.shredded, []uuid.UUID{old.ID}) {
		t.Fatalf("shredded %v, want the 2015 invoice", f.repo.shredded)
	}
	if got := f.repo.docs[recent.ID].RetainUntil; got == nil || *got != "2031-01-01" {
		t.Errorf("2020 invoice kept until %v", got)
	}
	for name, id := range map[string]uuid.UUID{"certificate (employed)": cert.ID, "other": other.ID, "form (still held)": form} {
		if got := f.repo.docs[id].RetainUntil; got != nil {
			t.Errorf("%s kept until %v", name, *got)
		}
	}
	if got := f.repo.docs[removed.ID].RetainUntil; got == nil || *got != "2030-01-01" {
		t.Errorf("a removed invoice waits for its day: %v", got)
	}

	// The asset returned in 2014 and the employee left in 2022: both due.
	recs.ended[assignment] = "2014-06-30"
	f.ended[ana] = "2022-05-31"
	// A hold keeps the form past its day.
	if _, err := f.svc.SetHold(ctx, manager, form, ptr("2026-12-31"), "Audit"); err != nil {
		t.Fatalf("hold an archived form with vault.manage: %v", err)
	}
	if res, err := f.svc.ShredDue(ctx, logger); err != nil || res.Documents != 1 {
		t.Fatalf("second run: %+v %v", res, err)
	}
	if !slices.Contains(f.repo.shredded, cert.ID) || slices.Contains(f.repo.shredded, form) {
		t.Errorf("shredded %v: want the certificate, not the held form", f.repo.shredded)
	}
	if got := f.repo.docs[form].RetainUntil; got == nil || *got != "2025-01-01" {
		t.Errorf("form kept until %v, want 2025-01-01", got)
	}
}

// Legal Hold: only on a type whose retention shreds; on a type no one
// manages here, by vault.manage.
func TestHoldNeedsATimedType(t *testing.T) {
	f := newSealedFixture(t)
	ctx := context.Background()
	d, err := f.svc.Upload(ctx, manager, "other", Details{Title: "Notes"}, Upload{FileName: "x.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.SetHold(ctx, manager, d.ID, ptr("2027-01-01"), "Audit"); !errors.Is(err, ErrInvalid) {
		t.Errorf("hold a document kept until removed: %v", err)
	}
	inv, err := f.svc.Upload(ctx, manager, "invoice", Details{Title: "Invoice"}, Upload{FileName: "x.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.SetHold(ctx, reader, inv.ID, ptr("2027-01-01"), "Audit"); !errors.Is(err, ErrForbidden) {
		t.Errorf("a reader holds: %v", err)
	}
	if _, err := f.svc.SetHold(ctx, manager, inv.ID, ptr("2027-01-01"), "Audit"); err != nil {
		t.Errorf("a manager holds an invoice: %v", err)
	}
}
