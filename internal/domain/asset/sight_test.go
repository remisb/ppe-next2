package asset

import (
	"errors"
	"slices"
	"testing"
)

// all sees every asset, as a reader with equipment.read does.
var all = Sight{Equipment: true}

func TestSight(t *testing.T) {
	sims := Sight{}
	if !sims.Sees(KindSIM) || sims.Sees(KindEquipment) || !slices.Equal(sims.Kinds(), []Kind{KindSIM}) {
		t.Errorf("without equipment: sees %v", sims.Kinds())
	}
	if !errors.Is(sims.Check(KindEquipment), ErrNotPermitted) || sims.Check(KindSIM) != nil {
		t.Error("without equipment: Check")
	}
	if !all.Sees(KindEquipment) || !slices.Equal(all.Kinds(), []Kind{KindSIM, KindEquipment}) || all.Check(KindEquipment) != nil {
		t.Errorf("with equipment: sees %v", all.Kinds())
	}
}

// Equipment & Furniture, and who holds each item, are for readers allowed
// equipment.read: without it the reads leave them out, refuse them by kind,
// and an item is not found. SIMs stay everyone's.
func TestEquipmentNeedsSight(t *testing.T) {
	f := newFixture(t)
	sim := f.sim(t, "SIM-000001", StatusActive, true)
	if _, err := f.give(t, sim.ID, f.emp, "2026-10-09"); err != nil {
		t.Fatal(err)
	}
	desk, err := f.svc.Create(f.ctx, CreateParams{Kind: KindEquipment, Params: Params{InventoryNo: "FUR-000001", Name: sp("Desk"), Category: ptr(CategoryFurniture)}}, testActor)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Give(f.ctx, desk.ID, GiveParams{FormParams: FormParams{EmployeeID: f.emp.ID, GivenDate: "2026-10-09"}}, testActor); err != nil {
		t.Fatal(err)
	}
	sims := Sight{}

	if _, err := f.svc.List(f.ctx, ListParams{Kind: "EQUIPMENT"}, sims); !errors.Is(err, ErrNotPermitted) {
		t.Errorf("list equipment: %v, want ErrNotPermitted", err)
	}
	if res, err := f.svc.List(f.ctx, ListParams{Kind: "SIM"}, sims); err != nil || res.Total != 1 {
		t.Errorf("list SIMs = %d, %v", res.Total, err)
	}
	if _, err := f.svc.Summary(f.ctx, "EQUIPMENT", sims); !errors.Is(err, ErrNotPermitted) {
		t.Errorf("summary equipment: %v, want ErrNotPermitted", err)
	}
	if vs, _ := f.svc.ByNumber(f.ctx, "0001", sims); len(vs) != 1 || vs[0].Kind != KindSIM {
		t.Errorf("search = %+v, want the SIM alone", vs)
	}
	if hs, _ := f.svc.ByEmployee(f.ctx, f.emp.ID, sims); len(hs) != 1 || hs[0].Asset.Kind != KindSIM {
		t.Errorf("held = %+v, want the SIM alone", hs)
	}
	if err := f.svc.Seen(f.ctx, desk.ID, sims); !errors.Is(err, ErrNotFound) {
		t.Errorf("seen desk: %v, want ErrNotFound", err)
	}
	if err := f.svc.Seen(f.ctx, sim.ID, sims); err != nil {
		t.Errorf("seen SIM: %v", err)
	}

	if vs, _ := f.svc.ByNumber(f.ctx, "0001", all); len(vs) != 2 {
		t.Errorf("search with equipment = %d, want 2", len(vs))
	}
	if hs, _ := f.svc.ByEmployee(f.ctx, f.emp.ID, all); len(hs) != 2 {
		t.Errorf("held with equipment = %d, want 2", len(hs))
	}
	if err := f.svc.Seen(f.ctx, desk.ID, all); err != nil {
		t.Errorf("seen desk with equipment: %v", err)
	}
	// Deleting an employee still sees everything they hold.
	if held, _ := f.svc.HeldBy(f.ctx, f.emp.ID); len(held) != 2 {
		t.Errorf("HeldBy = %v, want both", held)
	}
}
