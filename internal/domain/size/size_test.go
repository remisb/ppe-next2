package size

import "testing"

func TestClothingVocabulary(t *testing.T) {
	want := []string{"44", "46", "48", "50", "52", "54", "56", "58", "60", "62", "64", "66"}
	got := Clothing()
	if len(got) != len(want) {
		t.Fatalf("got %d clothing sizes, want %d", len(got), len(want))
	}
	for i, s := range got {
		if s.Code != want[i] {
			t.Errorf("size %d = %s, want %s", i, s.Code, want[i])
		}
		if (s.MinCm == nil) != (s.MaxCm == nil) {
			t.Errorf("%s has only one end of a height range", s.Code)
		}
	}
}

// The six banded sizes' ranges follow one another without a gap or overlap.
func TestClothingRangesContiguous(t *testing.T) {
	var banded []ClothingSize
	for _, s := range clothingSizes {
		if s.MinCm != nil {
			banded = append(banded, s)
		}
	}
	codes := ""
	for _, s := range banded {
		codes += s.Code + " "
	}
	if codes != "46 50 54 58 62 66 " {
		t.Fatalf("banded sizes = %s, want 46 50 54 58 62 66", codes)
	}
	for i, cur := range banded {
		if *cur.MinCm > *cur.MaxCm {
			t.Errorf("%s has an empty range", cur.Code)
		}
		if i == 0 {
			continue
		}
		prev := banded[i-1]
		if *cur.MinCm != *prev.MaxCm+1 {
			t.Errorf("%s starts at %d, want %d (right after %s)", cur.Code, *cur.MinCm, *prev.MaxCm+1, prev.Code)
		}
	}
	if *banded[0].MinCm != 160 || *banded[len(banded)-1].MaxCm != 200 {
		t.Errorf("bands span %d–%d, want 160–200", *banded[0].MinCm, *banded[len(banded)-1].MaxCm)
	}
}

func TestSuggestClothing(t *testing.T) {
	tests := []struct {
		height int
		want   string
		ok     bool
	}{
		{159, "", false}, {160, "46", true}, {167, "46", true}, {168, "50", true}, {175, "50", true},
		{176, "54", true}, {181, "54", true}, {182, "58", true}, {187, "58", true},
		{188, "62", true}, {193, "62", true}, {194, "66", true}, {200, "66", true}, {201, "", false},
	}
	for _, tt := range tests {
		got, ok := SuggestClothing(tt.height)
		if got != tt.want || ok != tt.ok {
			t.Errorf("SuggestClothing(%d) = %q, %v; want %q, %v", tt.height, got, ok, tt.want, tt.ok)
		}
	}
}

func TestIsClothingNumber(t *testing.T) {
	for n := 40; n <= 70; n++ {
		want := n >= 44 && n <= 66 && n%2 == 0
		if got := IsClothingNumber(n); got != want {
			t.Errorf("IsClothingNumber(%d) = %v, want %v", n, got, want)
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
		{GroupClothing, s("44"), true},
		{GroupClothing, s("54"), true},
		{GroupClothing, s("66"), true},
		{GroupClothing, s("42"), false},
		{GroupClothing, s("45"), false}, // odd
		{GroupClothing, s("68"), false}, // above the range
		{GroupClothing, s("054"), false},
		// Letter sizes stay on old order lines but a new line cannot use them.
		{GroupClothing, s("M"), false},
		{GroupClothing, s("3XL"), false},
		{GroupClothing, nil, false},
		{GroupShoes, s("42"), true},
		{GroupShoes, s("44"), true},
		{GroupShoes, s("47"), false},
		{GroupShoes, s("48"), false}, // a clothing size, not a shoe size
		{GroupShoes, s("M"), false},
		{GroupNone, nil, true},
		{GroupNone, s("50"), false},
		{Group("GLOVES"), nil, false},
	}
	for _, tt := range tests {
		if got := Fits(tt.g, tt.size); got != tt.want {
			t.Errorf("Fits(%s, %v) = %v, want %v", tt.g, deref(tt.size), got, tt.want)
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
		{"clothing saved wins over height", GroupClothing, Defaults{HeightCm: h(190), ClothingSize: h(50)}, Resolution{Size: s("50")}},
		{"clothing saved without a band", GroupClothing, Defaults{ClothingSize: h(44)}, Resolution{Size: s("44")}},
		{"clothing from height", GroupClothing, Defaults{HeightCm: h(178)}, Resolution{Size: s("54"), Suggested: true}},
		{"clothing height out of range", GroupClothing, Defaults{HeightCm: h(150)}, Resolution{Missing: true}},
		{"clothing nothing", GroupClothing, Defaults{}, Resolution{Missing: true}},
		{"shoes saved", GroupShoes, Defaults{ShoeSize: s("43")}, Resolution{Size: s("43")}},
		{"shoes never from height", GroupShoes, Defaults{HeightCm: h(180)}, Resolution{Missing: true}},
		{"shoes never from a clothing size", GroupShoes, Defaults{ClothingSize: h(44)}, Resolution{Missing: true}},
		{"none", GroupNone, Defaults{ClothingSize: h(50), ShoeSize: s("43")}, Resolution{}},
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
