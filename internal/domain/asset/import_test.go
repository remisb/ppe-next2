package asset

import (
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func importSIM(simNo, phoneNo string, status Status, holder *uuid.UUID) ImportSIM {
	p := Params{SimNo: sp(simNo), Provider: sp("Bitė")}
	if phoneNo != "" {
		p.PhoneNo = sp(phoneNo)
	}
	return ImportSIM{Params: p, Status: status, HolderID: holder}
}

func TestImportSIMs(t *testing.T) {
	f := newFixture(t)
	f.sim(t, "SIM-000004", StatusActive, true) // the counter is at 4
	p := ImportParams{Comment: "Imported", SIMs: []ImportSIM{
		importSIM("1237002240500235267F", "+370 603 27629", StatusActive, &f.emp.ID),
		importSIM("1237002250200908444F", "+370 699 49054", StatusBlocked, &f.emp2.ID),
		importSIM("1237002250201583196", "", StatusActive, nil),
	}}

	// A dry run numbers and checks everything and keeps nothing.
	dry, err := f.svc.ImportSIMs(f.ctx, p, testActor)
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if dry.Committed || len(f.repo.assets) != 1 || len(f.repo.events) != 1 {
		t.Fatalf("dry run kept something: committed %v, %d assets, %d events", dry.Committed, len(f.repo.assets), len(f.repo.events))
	}

	p.Commit = true
	res, err := f.svc.ImportSIMs(f.ctx, p, testActor)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	var numbers []string
	for _, s := range res.SIMs {
		numbers = append(numbers, s.InventoryNo)
	}
	if want := []string{"SIM-000005", "SIM-000006", "SIM-000007"}; !slices.Equal(numbers, want) {
		t.Errorf("numbers = %v, want %v", numbers, want)
	}
	if res.SIMs[0].Holder != "Jonas Petraitis" || res.SIMs[2].Holder != "" {
		t.Errorf("holders = %q, %q", res.SIMs[0].Holder, res.SIMs[2].Holder)
	}

	// Held, with no form, given today; Blocked and still held.
	held, err := f.svc.Get(f.ctx, res.SIMs[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	if held.Location != LocationWithEmployee || *held.ConnectionStatus != StatusBlocked {
		t.Errorf("blocked card: %s, %s; want with the employee, Blocked", held.Location, *held.ConnectionStatus)
	}
	as := held.Open.Assignment
	if as.EmployeeID != f.emp2.ID || as.Form != nil || as.PaperFormSigned || as.GivenDate != "2026-10-09" || as.Comment != "Imported" {
		t.Errorf("assignment = %+v", as)
	}
	free, _ := f.svc.Get(f.ctx, res.SIMs[2].ID)
	if free.Location != LocationOffice || free.Open != nil || free.PhoneNo != nil {
		t.Errorf("free card: %s, open %v, phone %v", free.Location, free.Open, free.PhoneNo)
	}
	if got := f.eventNames(); !slices.Equal(got[1:], []string{EventRegistered, EventGiven, EventRegistered, EventGiven, EventRegistered}) {
		t.Errorf("events = %v", got)
	}
	if next, _ := f.svc.NextNumber(f.ctx, PrefixSIM); next != "SIM-000008" {
		t.Errorf("next number = %s", next)
	}

	// Run again: every card is registered already, so nothing is written.
	_, err = f.svc.ImportSIMs(f.ctx, p, testActor)
	var row *ImportRowError
	if !errors.As(err, &row) || row.Index != 0 || !errors.Is(err, ErrSIMNoTaken) {
		t.Fatalf("second import = %v, want row 0 SIM taken", err)
	}
	if len(f.repo.assets) != 4 {
		t.Errorf("%d assets after the refused import, want 4", len(f.repo.assets))
	}
}

func TestImportSIMsRefusesTheWholeFile(t *testing.T) {
	stranger := uuid.New()
	for _, tc := range []struct {
		name  string
		sims  []ImportSIM
		index int
		want  error
	}{
		{"same SIM twice", []ImportSIM{
			importSIM("8937001", "", StatusActive, nil), importSIM("8937 001", "", StatusActive, nil),
		}, 1, ErrSIMNoTaken},
		{"bad phone", []ImportSIM{
			importSIM("8937001", "", StatusActive, nil), importSIM("8937002", "phone", StatusActive, nil),
		}, 1, ErrInvalid},
		{"no such employee", []ImportSIM{importSIM("8937001", "", StatusActive, &stranger)}, 0, ErrEmployeeNotFound},
		{"bad status", []ImportSIM{importSIM("8937001", "", "AVAILABLE", nil)}, 0, ErrInvalid},
		{"inventory number given", []ImportSIM{{Params: Params{InventoryNo: "SIM-1", SimNo: sp("1"), Provider: sp("Bitė")}, Status: StatusActive}}, 0, ErrInvalid},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture(t)
			_, err := f.svc.ImportSIMs(f.ctx, ImportParams{SIMs: tc.sims, Commit: true}, testActor)
			var row *ImportRowError
			if !errors.As(err, &row) || row.Index != tc.index || !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want row %d: %v", err, tc.index, tc.want)
			}
			if len(f.repo.assets) != 0 || len(f.repo.events) != 0 {
				t.Errorf("kept %d assets, %d events", len(f.repo.assets), len(f.repo.events))
			}
		})
	}
}

// A SIM card held since the import has no stored form: Print Form builds one
// from the card and the holder now, dated ImportedFormDate, and stores nothing.
func TestImportedSIMFormIsBuiltWhenPrinted(t *testing.T) {
	f := newFixture(t)
	res, err := f.svc.ImportSIMs(f.ctx, ImportParams{Comment: "Imported", Commit: true, SIMs: []ImportSIM{
		importSIM("1237002240500235267F", "+370 603 27629", StatusActive, &f.emp.ID),
	}}, testActor)
	if err != nil {
		t.Fatal(err)
	}
	card, _ := f.svc.Get(f.ctx, res.SIMs[0].ID)
	as := card.Open.Assignment
	// The form needs the non-return value, which the import leaves empty.
	if _, err := f.svc.Form(f.ctx, card.ID, as.ID); !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "non_return_value_cents") {
		t.Fatalf("form without a value: %v", err)
	}
	if _, err := f.svc.Update(f.ctx, card.ID, Params{InventoryNo: card.InventoryNo, SimNo: card.SimNo, Provider: card.Provider, PhoneNo: card.PhoneNo,
		NonReturnValueCents: ip(2500), ReceivedDate: card.ReceivedDate}, testActor); err != nil {
		t.Fatal(err)
	}
	form, err := f.svc.Form(f.ctx, card.ID, as.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"given_date":"` + ImportedFormDate + `"`, `"first_name":"Jonas"`, `"non_return_value_cents":2500`, `"inventory_no":"` + card.InventoryNo + `"`} {
		if !strings.Contains(string(form.Form), want) {
			t.Errorf("form %s lacks %s", form.Form, want)
		}
	}
	again, _ := f.svc.Form(f.ctx, card.ID, as.ID)
	if again.DocumentHash != form.DocumentHash {
		t.Error("the same card and holder built another form")
	}
	// Printing it is recorded and stores nothing: the giving stays as imported.
	if err := f.svc.RecordFormReprinted(f.ctx, card.ID, as.ID, OutputPrint, testActor); err != nil {
		t.Fatal(err)
	}
	if ev := f.repo.events[len(f.repo.events)-1]; ev.Event != EventFormPrinted || !strings.Contains(string(ev.After), form.DocumentHash) {
		t.Errorf("printed: %s %s", ev.Event, ev.After)
	}
	if got, _ := f.svc.Get(f.ctx, card.ID); got.Open.Assignment.Form != nil || got.Open.Assignment.PaperFormSigned {
		t.Errorf("printing stored a form: %+v", got.Open.Assignment)
	}
	// Once returned, the holding is a record: no form is built for it.
	if _, err := f.svc.Return(f.ctx, card.ID, ReturnParams{ReturnedDate: "2026-10-09"}, testActor); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Form(f.ctx, card.ID, as.ID); !errors.Is(err, ErrNoForm) {
		t.Errorf("returned: %v, want ErrNoForm", err)
	}
}
