package placeholder

import (
	"errors"
	"slices"
	"testing"
)

func TestParse(t *testing.T) {
	known := func(k string) bool { return k == "employee.name" || k == "today" }
	segs, err := Parse("Dear {{ employee.name }}, }} today {{today}}.", known)
	if err != nil {
		t.Fatal(err)
	}
	want := []Segment{{Text: "Dear "}, {Field: "employee.name"}, {Text: ", }} today "}, {Field: "today"}, {Text: "."}}
	if !slices.Equal(segs, want) {
		t.Fatalf("segments = %+v", segs)
	}
	if got := Render(segs, func(k string) string { return "<" + k + ">" }); got != "Dear <employee.name>, }} today <today>." {
		t.Errorf("render = %q", got)
	}
	for in, want := range map[string]error{"{{employee.name": ErrUnclosed, "{{a {{b}}": ErrUnclosed, "{{salary}}": ErrUnknown} {
		if _, err := Parse(in, known); !errors.Is(err, want) {
			t.Errorf("%q: %v, want %v", in, err, want)
		}
	}
	if _, err := Parse("{{salary}}", known); err.Error() != "uses an unknown field {{salary}}" {
		t.Errorf("message = %q", err)
	}
}
