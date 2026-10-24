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
		{"full", Params{Name: "Safety shoes", AccountingPriceCents: i64(4999), ServicePeriodMonths: ip(12), Active: true}, nil},
		{"price not yet set", Params{Name: "Helmet"}, nil},
		{"free item", Params{Name: "Earplugs", AccountingPriceCents: i64(0)}, nil},
		{"no name", Params{}, ErrInvalid},
		{"unknown picture", Params{Name: "Gloves", Icon: "boot"}, ErrInvalid},
		{"negative price", Params{Name: "X", AccountingPriceCents: i64(-1)}, ErrInvalid},
		{"negative purchase price", Params{Name: "X", PurchasePriceCents: i64(-1)}, ErrInvalid},
		{"zero period", Params{Name: "X", ServicePeriodMonths: ip(0)}, ErrInvalid},
		{"negative rank", Params{Name: "X", DisplayRank: ip(-1)}, ErrInvalid},
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
	p := Params{Name: " X "}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	if p.Name != "X" || p.Icon != IconOther || *p.DisplayRank != DefaultDisplayRank {
		t.Errorf("normalized = %+v", p)
	}
	item := Item{Active: true, AccountingPriceCents: i64(100), ServicePeriodMonths: ip(6)}
	if !item.Orderable() {
		t.Error("complete active item should be orderable")
	}
	for name, mutate := range map[string]func(*Item){
		"inactive":  func(i *Item) { i.Active = false },
		"no price":  func(i *Item) { i.AccountingPriceCents = nil },
		"no period": func(i *Item) { i.ServicePeriodMonths = nil },
	} {
		it := item
		mutate(&it)
		if it.Orderable() {
			t.Errorf("%s: should not be orderable", name)
		}
	}
}

func TestPictureParamsValidate(t *testing.T) {
	p := PictureParams{SizeGroup: " clothing "}
	if err := p.Validate(); err != nil || p.SizeGroup != size.GroupClothing {
		t.Errorf("normalized = %+v, err %v", p, err)
	}
	for _, g := range []size.Group{"", "GLOVES"} {
		p := PictureParams{SizeGroup: g}
		if err := p.Validate(); !errors.Is(err, ErrInvalid) {
			t.Errorf("size group %q: err = %v", g, err)
		}
	}
}
