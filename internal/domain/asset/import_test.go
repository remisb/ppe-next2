package asset

import (
	"errors"
	"slices"
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
