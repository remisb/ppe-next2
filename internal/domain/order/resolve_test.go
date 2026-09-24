package order

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/size"
)

type fakeEmployees map[uuid.UUID]EmployeeView

func (f fakeEmployees) Employee(_ context.Context, id uuid.UUID) (EmployeeView, error) {
	e, ok := f[id]
	if !ok {
		return EmployeeView{}, ErrEmployeeNotFound
	}
	return e, nil
}

type fakeCatalogue map[uuid.UUID]ItemView

func (f fakeCatalogue) Items(_ context.Context, ids []uuid.UUID) (map[uuid.UUID]ItemView, error) {
	out := map[uuid.UUID]ItemView{}
	for _, id := range ids {
		if it, ok := f[id]; ok {
			out[id] = it
		}
	}
	return out, nil
}

type fakeSets map[uuid.UUID][]SetLineView

func (f fakeSets) ActiveSetLines(_ context.Context, id uuid.UUID) ([]SetLineView, error) {
	l, ok := f[id]
	if !ok {
		return nil, ErrItemSetNotFound
	}
	return l, nil
}

func i64(v int64) *int64 { return &v }
func ip(v int) *int      { return &v }

type fixture struct {
	svc                                   *Service
	emp, empNoSizes                       uuid.UUID
	shoes, jacket, gloves, draft, retired uuid.UUID
	set                                   uuid.UUID
}

func newFixture() fixture {
	f := fixture{
		emp: uuid.New(), empNoSizes: uuid.New(),
		shoes: uuid.New(), jacket: uuid.New(), gloves: uuid.New(), draft: uuid.New(), retired: uuid.New(),
		set: uuid.New(),
	}
	item := func(id uuid.UUID, name string, g size.Group) ItemView {
		return ItemView{ID: id, Name: name, SizeGroup: g, UnitPriceCents: i64(1000), Currency: "EUR", ServicePeriodMonths: ip(12), Active: true}
	}
	draft := item(f.draft, "Helmet", size.GroupNone)
	draft.UnitPriceCents = nil
	retired := item(f.retired, "Old vest", size.GroupClothing)
	retired.Active = false
	f.svc = NewService(nil, Readers{
		Employees: fakeEmployees{
			f.emp:        {ID: f.emp, FirstName: "Jonas", Sizes: size.Defaults{HeightCm: ip(185), ShoeSize: sp("43")}},
			f.empNoSizes: {ID: f.empNoSizes, FirstName: "Ona"},
		},
		Catalogue: fakeCatalogue{
			f.shoes:   item(f.shoes, "Safety shoes", size.GroupShoes),
			f.jacket:  item(f.jacket, "Work jacket", size.GroupClothing),
			f.gloves:  item(f.gloves, "Protective gloves", size.GroupNone),
			f.draft:   draft,
			f.retired: retired,
		},
		ItemSets: fakeSets{f.set: {{f.jacket, 1}, {f.shoes, 2}, {f.gloves, 5}}},
	})
	return f
}

func TestResolveAlgorithmA(t *testing.T) {
	f := newFixture()
	res, err := f.svc.Resolve(context.Background(), f.emp, []ResolveLine{
		{f.shoes, 1}, {f.jacket, 1}, {f.gloves, 2}, {f.draft, 1}, {f.retired, 1}, {uuid.New(), 1},
	})
	if err != nil {
		t.Fatal(err)
	}
	l := res.Lines
	if *l[0].Size != "43" || l[0].SizeSuggested || l[0].SizeMissing {
		t.Errorf("shoes = %+v", l[0])
	}
	if *l[1].Size != "XL" || !l[1].SizeSuggested { // 185 cm → XL, suggested from height
		t.Errorf("jacket = %+v", l[1])
	}
	if l[2].Size != nil || l[2].SizeMissing || l[2].Quantity != 2 {
		t.Errorf("gloves = %+v", l[2])
	}
	if !l[3].PriceMissing || l[3].Unavailable {
		t.Errorf("draft = %+v", l[3])
	}
	if !l[4].Unavailable || l[4].ItemName != "Old vest" {
		t.Errorf("retired = %+v", l[4])
	}
	if !l[5].Unavailable || l[5].ItemName != "" {
		t.Errorf("unknown = %+v", l[5])
	}
	if res.Orderable() {
		t.Error("resolution with problems reported orderable")
	}
}

func TestResolveMissingSizesKeepLines(t *testing.T) {
	f := newFixture()
	res, err := f.svc.Resolve(context.Background(), f.empNoSizes, []ResolveLine{{f.shoes, 1}, {f.jacket, 1}, {f.gloves, 1}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Lines) != 3 || !res.Lines[0].SizeMissing || !res.Lines[1].SizeMissing || res.Lines[2].SizeMissing {
		t.Errorf("lines = %+v", res.Lines)
	}
}

func TestResolveMergesRepeatedItems(t *testing.T) {
	f := newFixture()
	res, err := f.svc.Resolve(context.Background(), f.emp, []ResolveLine{{f.gloves, 1}, {f.shoes, 1}, {f.gloves, 2}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Lines) != 2 || res.Lines[0].CatalogueItemID != f.gloves || res.Lines[0].Quantity != 3 {
		t.Errorf("lines = %+v", res.Lines)
	}
	if !res.Orderable() {
		t.Error("clean resolution should be orderable")
	}
}

func TestResolveErrors(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	cases := map[string]struct {
		emp   uuid.UUID
		lines []ResolveLine
		want  error
	}{
		"no employee":      {uuid.Nil, nil, ErrInvalid},
		"unknown employee": {uuid.New(), nil, ErrEmployeeNotFound},
		"zero quantity":    {f.emp, []ResolveLine{{f.shoes, 0}}, ErrInvalid},
		"nil item":         {f.emp, []ResolveLine{{uuid.Nil, 1}}, ErrInvalid},
	}
	for name, c := range cases {
		if _, err := f.svc.Resolve(ctx, c.emp, c.lines); !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v, want %v", name, err, c.want)
		}
	}
}

func TestApplyItemSet(t *testing.T) {
	f := newFixture()
	res, err := f.svc.ApplyItemSet(context.Background(), f.set, f.emp)
	if err != nil {
		t.Fatal(err)
	}
	want := []struct {
		id  uuid.UUID
		qty int
	}{{f.jacket, 1}, {f.shoes, 2}, {f.gloves, 5}}
	for i, w := range want {
		if res.Lines[i].CatalogueItemID != w.id || res.Lines[i].Quantity != w.qty {
			t.Errorf("line %d = %+v", i, res.Lines[i])
		}
	}
	if _, err := f.svc.ApplyItemSet(context.Background(), uuid.New(), f.emp); !errors.Is(err, ErrItemSetNotFound) {
		t.Errorf("unknown set err = %v", err)
	}
}
