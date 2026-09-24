package employee

import (
	"errors"
	"strings"
	"testing"
)

func sp(s string) *string { return &s }
func ip(i int) *int       { return &i }

func TestParamsValidate(t *testing.T) {
	tests := []struct {
		name string
		p    Params
		want error
	}{
		{"names only", Params{FirstName: " Jonas ", LastName: "Petraitis"}, nil},
		{"all sizes", Params{FirstName: "A", LastName: "B", HeightCm: ip(180), ClothingSize: sp("xl"), ShoeSize: sp("43")}, nil},
		{"blank optional fields", Params{FirstName: "A", LastName: "B", Code: sp("  "), ClothingSize: sp(""), ShoeSize: sp(" ")}, nil},
		{"missing first", Params{LastName: "B"}, ErrInvalid},
		{"missing last", Params{FirstName: "A", LastName: "  "}, ErrInvalid},
		{"height too low", Params{FirstName: "A", LastName: "B", HeightCm: ip(99)}, ErrInvalid},
		{"height too high", Params{FirstName: "A", LastName: "B", HeightCm: ip(251)}, ErrInvalid},
		{"unknown clothing", Params{FirstName: "A", LastName: "B", ClothingSize: sp("XXL")}, ErrInvalid},
		{"shoe in clothing", Params{FirstName: "A", LastName: "B", ClothingSize: sp("42")}, ErrInvalid},
		{"unknown shoe", Params{FirstName: "A", LastName: "B", ShoeSize: sp("38")}, ErrInvalid},
		{"long code", Params{FirstName: "A", LastName: "B", Code: sp(strings.Repeat("x", 51))}, ErrInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.p.Validate(); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestNormalize(t *testing.T) {
	p := Params{FirstName: " A ", LastName: " B ", Code: sp(" "), ClothingSize: sp(" xl "), ShoeSize: sp("")}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	if p.FirstName != "A" || p.Code != nil || p.ShoeSize != nil || *p.ClothingSize != "XL" {
		t.Errorf("normalized = %+v", p)
	}
	e := Employee{FirstName: "A", LastName: "B"}
	if e.FullName() != "A B" {
		t.Errorf("FullName = %q", e.FullName())
	}
}
