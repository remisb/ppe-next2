package asset

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

func (f *fakeRepo) StoredForm(_ context.Context, id uuid.UUID) (Asset, Assignment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, a := range f.assignments {
		if a.ID == id && a.Form != nil && a.DocumentHash != nil {
			return f.assets[a.AssetID], a, nil
		}
	}
	return Asset{}, Assignment{}, ErrNotFound
}

func (f *fakeRepo) FormsSince(_ context.Context, since time.Time) ([]uuid.UUID, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []uuid.UUID{}
	for _, a := range f.assignments {
		if a.Form != nil && a.DocumentHash != nil && !a.CreatedAt.Before(since) {
			out = append(out, a.ID)
		}
	}
	return out, nil
}

// archived records what the archiver was told.
type archived struct{ ids []uuid.UUID }

func (a *archived) FormStored(_ context.Context, id uuid.UUID) { a.ids = append(a.ids, id) }

// Give tells the archiver of a stored form once it is given, and of nothing
// else; the stored form hashes as Give stored it, and the sweep finds it.
func TestGiveArchivesTheStoredForm(t *testing.T) {
	f := newFixture(t)
	arch := &archived{}
	WithArchiver(arch)(f.svc)
	sim := f.sim(t, "SIM-000001", StatusActive, true)
	a, err := f.give(t, sim.ID, f.emp, "2026-10-01")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(arch.ids, []uuid.UUID{a.ID}) {
		t.Fatalf("archiver told %v, want %s", arch.ids, a.ID)
	}
	// A refused giving and an asset without a form tell it nothing.
	if _, err := f.give(t, sim.ID, f.emp2, "2026-10-02"); !errors.Is(err, ErrAlreadyGiven) {
		t.Fatalf("second give: %v", err)
	}
	desk, err := f.svc.Create(f.ctx, CreateParams{Kind: KindEquipment, Params: Params{InventoryNo: "FUR-000001", Name: sp("Desk"), Category: ptr(CategoryFurniture)}}, testActor)
	if err != nil {
		t.Fatal(err)
	}
	given, err := f.svc.Give(f.ctx, desk.ID, GiveParams{FormParams: FormParams{EmployeeID: f.emp.ID, GivenDate: "2026-10-09"}}, testActor)
	if err != nil {
		t.Fatal(err)
	}
	if len(arch.ids) != 1 {
		t.Errorf("archiver told %v after a refusal and a desk", arch.ids)
	}

	got, err := f.svc.StoredForm(f.ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Matches() || got.DocumentHash != *a.DocumentHash || got.Asset.InventoryNo != "SIM-000001" ||
		got.Form.GivenDate != "2026-10-01" || got.Assignment.EmployeeID != f.emp.ID {
		t.Errorf("stored form = %+v", got)
	}
	if _, err := f.svc.StoredForm(f.ctx, given.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("a desk's form: %v, want ErrNotFound", err)
	}
	ids, err := f.svc.FormsSince(f.ctx, time.Time{})
	if err != nil || !slices.Equal(ids, []uuid.UUID{a.ID}) {
		t.Errorf("forms since = %v, %v", ids, err)
	}
	if ids, _ := f.svc.FormsSince(f.ctx, testNow.Add(time.Hour)); len(ids) != 0 {
		t.Errorf("forms since later = %v", ids)
	}
}
