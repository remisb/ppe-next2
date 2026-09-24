package order

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/size"
)

func sp(s string) *string { return &s }

func TestMarkAsOrderedValidate(t *testing.T) {
	emp, a, b := uuid.New(), uuid.New(), uuid.New()
	tests := []struct {
		name string
		p    MarkAsOrderedParams
		want error
	}{
		{"ok", MarkAsOrderedParams{emp, []LineParams{{a, 1, sp("M")}, {b, 2, nil}}}, nil},
		{"no employee", MarkAsOrderedParams{uuid.Nil, []LineParams{{a, 1, nil}}}, ErrInvalid},
		{"no lines", MarkAsOrderedParams{emp, nil}, ErrInvalid},
		{"zero quantity", MarkAsOrderedParams{emp, []LineParams{{a, 0, nil}}}, ErrInvalid},
		{"negative quantity", MarkAsOrderedParams{emp, []LineParams{{a, -3, nil}}}, ErrInvalid},
		{"duplicate item", MarkAsOrderedParams{emp, []LineParams{{a, 1, nil}, {a, 1, nil}}}, ErrInvalid},
		{"nil item", MarkAsOrderedParams{emp, []LineParams{{uuid.Nil, 1, nil}}}, ErrInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.p.Validate(); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestCheckSize(t *testing.T) {
	if err := CheckSize(0, size.GroupClothing, sp("L")); err != nil {
		t.Error(err)
	}
	if err := CheckSize(0, size.GroupNone, nil); err != nil {
		t.Error(err)
	}
	for _, tc := range []struct {
		g size.Group
		s *string
	}{{size.GroupClothing, nil}, {size.GroupShoes, sp("M")}, {size.GroupNone, sp("M")}} {
		if err := CheckSize(2, tc.g, tc.s); !errors.Is(err, ErrInvalid) {
			t.Errorf("CheckSize(%s, %v) = %v, want ErrInvalid", tc.g, tc.s, err)
		}
	}
}

func TestTotalsAndRecordNumber(t *testing.T) {
	o := Order{RecordSeq: 42, Lines: []Line{{Quantity: 2, UnitPriceCents: 1250}, {Quantity: 1, UnitPriceCents: 499}}}
	if o.TotalCents() != 2999 {
		t.Errorf("total = %d", o.TotalCents())
	}
	if o.RecordNumber() != "WE-000042" {
		t.Errorf("record number = %s", o.RecordNumber())
	}
}

func TestUsageMonths(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Vilnius")
	if err != nil {
		t.Fatal(err)
	}
	given := time.Date(2026, 7, 21, 10, 0, 0, 0, time.UTC)
	now := given.Add(64 * 24 * time.Hour) // 64 / 30.44 = 2.10
	o := Order{Status: StatusGiven, GivenAt: &given}
	if m := UsageMonths(o, now, loc); m == nil || *m != 2.1 {
		t.Errorf("usage = %v, want 2.1", m)
	}
	if m := UsageMonths(Order{Status: StatusOrdered}, now, loc); m != nil {
		t.Errorf("ORDERED usage = %v, want nil", *m)
	}
}

func TestConfirmationUsable(t *testing.T) {
	now := time.Now()
	later, earlier := now.Add(time.Hour), now.Add(-time.Hour)
	base := Confirmation{Method: MethodElectronic, ExpiresAt: &later}
	if !base.Usable(now) {
		t.Error("fresh link should be usable")
	}
	for name, c := range map[string]Confirmation{
		"expired":   {Method: MethodElectronic, ExpiresAt: &earlier},
		"revoked":   {Method: MethodElectronic, ExpiresAt: &later, RevokedAt: &earlier},
		"confirmed": {Method: MethodElectronic, ExpiresAt: &later, ConfirmedAt: &earlier},
		"paper":     {Method: MethodPaper},
	} {
		if c.Usable(now) {
			t.Errorf("%s link should not be usable", name)
		}
	}
}
