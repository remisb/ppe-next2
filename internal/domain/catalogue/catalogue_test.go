package catalogue

import (
	"errors"
	"testing"

	"github.com/remisb/ppe-next2/internal/domain/size"
)

func i64(v int64) *int64 { return &v }
func ip(v int) *int      { return &v }

func TestParamsValidate(t *testing.T) {
	tests := []struct {
		name string
		p    Params
		want error
	}{
		{"full", Params{Name: "Safety shoes", SizeGroup: "shoes", UnitPriceCents: i64(4999), ServicePeriodMonths: ip(12), Active: true}, nil},
		{"price not yet set", Params{Name: "Helmet", SizeGroup: size.GroupNone}, nil},
		{"free item", Params{Name: "Earplugs", SizeGroup: size.GroupNone, UnitPriceCents: i64(0)}, nil},
		{"no name", Params{SizeGroup: size.GroupNone}, ErrInvalid},
		{"bad group", Params{Name: "Gloves", SizeGroup: "GLOVES"}, ErrInvalid},
		{"negative price", Params{Name: "X", SizeGroup: size.GroupNone, UnitPriceCents: i64(-1)}, ErrInvalid},
		{"zero period", Params{Name: "X", SizeGroup: size.GroupNone, ServicePeriodMonths: ip(0)}, ErrInvalid},
		{"negative rank", Params{Name: "X", SizeGroup: size.GroupNone, DisplayRank: ip(-1)}, ErrInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.p.Validate(); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestDefaultsAndOrderable(t *testing.T) {
	p := Params{Name: " X ", SizeGroup: " clothing "}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	if p.Name != "X" || p.SizeGroup != size.GroupClothing || *p.DisplayRank != DefaultDisplayRank {
		t.Errorf("normalized = %+v", p)
	}
	item := Item{Active: true, UnitPriceCents: i64(100), ServicePeriodMonths: ip(6)}
	if !item.Orderable() {
		t.Error("complete active item should be orderable")
	}
	for name, mutate := range map[string]func(*Item){
		"inactive":  func(i *Item) { i.Active = false },
		"no price":  func(i *Item) { i.UnitPriceCents = nil },
		"no period": func(i *Item) { i.ServicePeriodMonths = nil },
	} {
		it := item
		mutate(&it)
		if it.Orderable() {
			t.Errorf("%s: should not be orderable", name)
		}
	}
}
