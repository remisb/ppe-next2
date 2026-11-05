package asset

import (
	"errors"
	"slices"
	"testing"
)

// all sees every asset, as a reader with sim_cards.read and equipment.read
// does.
var all = Sight{SIM: true, Equipment: true}

func TestSight(t *testing.T) {
	sims := Sight{SIM: true}
	if !sims.Sees(KindSIM) || sims.Sees(KindEquipment) || !slices.Equal(sims.Kinds(), []Kind{KindSIM}) {
		t.Errorf("without equipment: sees %v", sims.Kinds())
	}
	if !errors.Is(sims.Check(KindEquipment), ErrNotPermitted) || sims.Check(KindSIM) != nil {
		t.Error("without equipment: Check")
	}
	if !all.Sees(KindEquipment) || !slices.Equal(all.Kinds(), []Kind{KindSIM, KindEquipment}) || all.Check(KindEquipment) != nil {
		t.Errorf("with equipment: sees %v", all.Kinds())
	}
	// Without sim_cards.read, SIM cards are refused as equipment is without
	// equipment.read; a kind that does not exist is left to validation.
	equipment := Sight{Equipment: true}
	if equipment.Sees(KindSIM) || !slices.Equal(equipment.Kinds(), []Kind{KindEquipment}) || !errors.Is(equipment.Check(KindSIM), ErrSIMsNotPermitted) {
		t.Errorf("without SIMs: sees %v", equipment.Kinds())
	}
	if none := (Sight{}); len(none.Kinds()) != 0 || none.Check("PHONE") != nil {
		t.Errorf("no sight: sees %v", none.Kinds())
	}
}

// Changing a SIM takes sim_cards.manage, an equipment item assets.manage.
func TestRights(t *testing.T) {
	for _, c := range []struct {
		may       Rights
		sim, item bool
	}{
		{Rights{}, false, false},
		{Rights{SIM: true}, true, false},
		{Rights{Equipment: true}, false, true},
		{Rights{SIM: true, Equipment: true}, true, true},
	} {
		if got := c.may.Check(KindSIM) == nil; got != c.sim {
			t.Errorf("%+v: may change a SIM = %v", c.may, got)
		}
		if got := c.may.Check(KindEquipment) == nil; got != c.item {
			t.Errorf("%+v: may change an item = %v", c.may, got)
		}
		if err := c.may.Check(KindSIM); err != nil && !errors.Is(err, ErrMayNotChange) {
			t.Errorf("%+v: %v, want ErrMayNotChange", c.may, err)
		}
	}
}

// Equipment & Furniture, and who holds each item, are for readers allowed
// equipment.read: without it the reads leave them out, refuse them by kind,
// and an item is not found. SIM cards are the same for sim_cards.read.
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
	sims := Sight{SIM: true}

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

	// Without sim_cards.read the SIM is hidden the same way.
	equipment := Sight{Equipment: true}
	if _, err := f.svc.List(f.ctx, ListParams{Kind: "SIM"}, equipment); !errors.Is(err, ErrSIMsNotPermitted) {
		t.Errorf("list SIMs without sight: %v, want ErrSIMsNotPermitted", err)
	}
	if hs, _ := f.svc.ByEmployee(f.ctx, f.emp.ID, equipment); len(hs) != 1 || hs[0].Asset.Kind != KindEquipment {
		t.Errorf("held without SIMs = %+v, want the desk alone", hs)
	}
	if err := f.svc.Seen(f.ctx, sim.ID, equipment); !errors.Is(err, ErrNotFound) {
		t.Errorf("seen SIM without sight: %v, want ErrNotFound", err)
	}

	// Changeable: not found when not seen, refused when seen but not allowed.
	if err := f.svc.Changeable(f.ctx, sim.ID, all, Rights{Equipment: true}); !errors.Is(err, ErrMayNotChange) {
		t.Errorf("change SIM with assets.manage only: %v, want ErrMayNotChange", err)
	}
	if err := f.svc.Changeable(f.ctx, sim.ID, all, Rights{SIM: true}); err != nil {
		t.Errorf("change SIM with sim_cards.manage: %v", err)
	}
	if err := f.svc.Changeable(f.ctx, desk.ID, Sight{SIM: true}, Rights{SIM: true, Equipment: true}); !errors.Is(err, ErrNotFound) {
		t.Errorf("change unseen desk: %v, want ErrNotFound", err)
	}
	if err := f.svc.Changeable(f.ctx, desk.ID, all, Rights{SIM: true}); !errors.Is(err, ErrMayNotChange) {
		t.Errorf("change desk with sim_cards.manage only: %v, want ErrMayNotChange", err)
	}
	// Deleting an employee still sees everything they hold.
	if held, _ := f.svc.HeldBy(f.ctx, f.emp.ID); len(held) != 2 {
		t.Errorf("HeldBy = %v, want both", held)
	}
}
