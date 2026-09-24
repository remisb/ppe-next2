package itemset

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestParamsValidate(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	tests := []struct {
		name string
		p    Params
		want error
	}{
		{"ok", Params{Name: "Warehouse starter", Lines: []LineParams{{a, 1}, {b, 2}}}, nil},
		{"no name", Params{Lines: []LineParams{{a, 1}}}, ErrInvalid},
		{"no lines", Params{Name: "X"}, ErrInvalid},
		{"nil item", Params{Name: "X", Lines: []LineParams{{uuid.Nil, 1}}}, ErrInvalid},
		{"duplicate item", Params{Name: "X", Lines: []LineParams{{a, 1}, {a, 1}}}, ErrInvalid},
		{"zero quantity", Params{Name: "X", Lines: []LineParams{{a, 0}}}, ErrInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.p.Validate(); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestToLinesKeepsOrder(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	lines := Params{Lines: []LineParams{{b, 3}, {a, 1}}}.ToLines()
	if lines[0].CatalogueItemID != b || lines[0].DisplayOrder != 0 || lines[1].DisplayOrder != 1 || lines[0].DefaultQuantity != 3 {
		t.Errorf("lines = %+v", lines)
	}
}
