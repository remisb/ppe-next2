package size

import "testing"

func TestClothingRangesContiguous(t *testing.T) {
	for i := 1; i < len(clothingSizes); i++ {
		prev, cur := clothingSizes[i-1], clothingSizes[i]
		if cur.MinCm != prev.MaxCm+1 {
			t.Errorf("%s starts at %d, want %d (right after %s)", cur.Code, cur.MinCm, prev.MaxCm+1, prev.Code)
		}
		if cur.MinCm > cur.MaxCm {
			t.Errorf("%s has an empty range", cur.Code)
		}
	}
}

func TestSuggestClothing(t *testing.T) {
	tests := []struct {
		height int
		want   string
		ok     bool
	}{
		{159, "", false}, {160, "S", true}, {167, "S", true}, {168, "M", true},
		{181, "L", true}, {182, "XL", true}, {193, "2XL", true}, {200, "3XL", true}, {201, "", false},
	}
	for _, tt := range tests {
		got, ok := SuggestClothing(tt.height)
		if got != tt.want || ok != tt.ok {
			t.Errorf("SuggestClothing(%d) = %q, %v; want %q, %v", tt.height, got, ok, tt.want, tt.ok)
		}
	}
}

func TestFits(t *testing.T) {
	s := func(v string) *string { return &v }
	tests := []struct {
		g    Group
		size *string
		want bool
	}{
		{GroupClothing, s("M"), true},
		{GroupClothing, s("42"), false},
		{GroupClothing, nil, false},
		{GroupShoes, s("42"), true},
		{GroupShoes, s("47"), false},
		{GroupShoes, s("M"), false},
		{GroupNone, nil, true},
		{GroupNone, s("M"), false},
		{Group("GLOVES"), nil, false},
	}
	for _, tt := range tests {
		if got := Fits(tt.g, tt.size); got != tt.want {
			t.Errorf("Fits(%s, %v) = %v, want %v", tt.g, tt.size, got, tt.want)
		}
	}
}

func TestResolve(t *testing.T) {
	s := func(v string) *string { return &v }
	h := func(v int) *int { return &v }
	tests := []struct {
		name string
		g    Group
		d    Defaults
		want Resolution
	}{
		{"clothing saved wins over height", GroupClothing, Defaults{HeightCm: h(190), ClothingSize: s("M")}, Resolution{Size: s("M")}},
		{"clothing from height", GroupClothing, Defaults{HeightCm: h(178)}, Resolution{Size: s("L"), Suggested: true}},
		{"clothing height out of range", GroupClothing, Defaults{HeightCm: h(150)}, Resolution{Missing: true}},
		{"clothing nothing", GroupClothing, Defaults{}, Resolution{Missing: true}},
		{"shoes saved", GroupShoes, Defaults{ShoeSize: s("43")}, Resolution{Size: s("43")}},
		{"shoes never from height", GroupShoes, Defaults{HeightCm: h(180)}, Resolution{Missing: true}},
		{"none", GroupNone, Defaults{ClothingSize: s("M"), ShoeSize: s("43")}, Resolution{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Resolve(tt.g, tt.d)
			if got.Suggested != tt.want.Suggested || got.Missing != tt.want.Missing ||
				(got.Size == nil) != (tt.want.Size == nil) || (got.Size != nil && *got.Size != *tt.want.Size) {
				t.Errorf("Resolve = %+v (size %v), want %+v (size %v)", got, deref(got.Size), tt.want, deref(tt.want.Size))
			}
		})
	}
}

func deref(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}
