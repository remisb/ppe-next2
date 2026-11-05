package mrz

import (
	"encoding/json"
	"os"
	"reflect"
	"strconv"
	"testing"
)

// testdata/mrz/vectors.json is read by @ppe/mrz's vectors.test.ts too, so the
// two parsers cannot drift apart (NFR-7). "expect" names only the fields a
// case is about; null is "absent"; problems, notes and corrections are
// compared as sets. Its "read" cases (finding the MRZ in OCR text) are the
// browser's alone: the API is sent lines, never text.
type vectors struct {
	Today string `json:"today"`
	Cases []struct {
		Name   string         `json:"name"`
		Lines  []string       `json:"lines"`
		Expect map[string]any `json:"expect"`
	} `json:"cases"`
	LtPersonalCodes []struct {
		Code      string  `json:"code"`
		Valid     bool    `json:"valid"`
		BirthDate *string `json:"birthDate"`
		Sex       *string `json:"sex"`
		Invalid   bool    `json:"invalid"`
	} `json:"ltPersonalCodes"`
	CheckDigits [][2]string `json:"checkDigits"`
	Fold        []struct {
		Name  string   `json:"name"`
		Forms []string `json:"forms"`
	} `json:"fold"`
	NameMatch []struct {
		Surname    string `json:"surname"`
		GivenNames string `json:"givenNames"`
		Field      string `json:"field"`
		Expect     string `json:"expect"`
	} `json:"nameMatch"`
}

func loadVectors(t *testing.T) vectors {
	t.Helper()
	b, err := os.ReadFile("../../../testdata/mrz/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

// asJSON is v as the JSON values @ppe/mrz's test compares (maps, slices, strings…).
func asJSON(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// asSet is a list of objects as a set of their JSON (json.Marshal sorts a map's keys).
func asSet(t *testing.T, v any) map[string]bool {
	t.Helper()
	set := map[string]bool{}
	list, _ := v.([]any)
	for _, x := range list {
		b, err := json.Marshal(x)
		if err != nil {
			t.Fatal(err)
		}
		set[string(b)] = true
	}
	return set
}

func TestVectorCases(t *testing.T) {
	v := loadVectors(t)
	if len(v.Cases) == 0 {
		t.Fatal("no cases read")
	}
	for _, c := range v.Cases {
		t.Run(c.Name, func(t *testing.T) {
			m := Parse(c.Lines, Options{Today: v.Today})
			if m == nil {
				t.Fatal("not parsed")
			}
			got, _ := asJSON(t, m).(map[string]any)
			for k, want := range c.Expect {
				switch k {
				case "problems", "notes", "corrections":
					if g, w := asSet(t, got[k]), asSet(t, want); !reflect.DeepEqual(g, w) {
						t.Errorf("%s = %v, want %v", k, g, w)
					}
				case "checks":
					g, _ := got[k].(map[string]any)
					for name, w := range want.(map[string]any) {
						if g[name] != w {
							t.Errorf("checks.%s = %v, want %v", name, g[name], w)
						}
					}
				default:
					if !reflect.DeepEqual(got[k], want) {
						t.Errorf("%s = %#v, want %#v", k, got[k], want)
					}
				}
			}
		})
	}
}

func TestVectorLtPersonalCodes(t *testing.T) {
	for _, c := range loadVectors(t).LtPersonalCodes {
		got, ok := ParseLtPersonalCode(c.Code)
		if c.Invalid {
			if ok {
				t.Errorf("%s: parsed, want not a code", c.Code)
			}
			continue
		}
		want := LtPersonalCode{Valid: c.Valid}
		if c.BirthDate != nil {
			want.BirthDate = *c.BirthDate
		}
		if c.Sex != nil {
			want.Sex = *c.Sex
		}
		if !ok || got != want {
			t.Errorf("%s = %+v, %v; want %+v", c.Code, got, ok, want)
		}
	}
}

func TestVectorCheckDigits(t *testing.T) {
	for _, c := range loadVectors(t).CheckDigits {
		d, ok := CheckDigit(c[0])
		if !ok || strconv.Itoa(d) != c[1] {
			t.Errorf("CheckDigit(%q) = %d, %v; want %s", c[0], d, ok, c[1])
		}
	}
}

func TestVectorFold(t *testing.T) {
	for _, c := range loadVectors(t).Fold {
		if got := Fold(c.Name); !reflect.DeepEqual(got, c.Forms) {
			t.Errorf("Fold(%q) = %q, want %q", c.Name, got, c.Forms)
		}
	}
}

func TestVectorNameMatch(t *testing.T) {
	for _, c := range loadVectors(t).NameMatch {
		if got := NameMatch(c.Surname, c.GivenNames, c.Field); string(got) != c.Expect {
			t.Errorf("NameMatch(%q, %q, %q) = %s, want %s", c.Surname, c.GivenNames, c.Field, got, c.Expect)
		}
	}
}

func TestParseRefusesWhatIsNoMRZ(t *testing.T) {
	for _, lines := range [][]string{
		nil,
		{"P<UTOERIKSSON"},
		{"P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F1204159ZE184226B<<<<<1"},
		{"p<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F1204159ZE184226B<<<<<10"},
	} {
		if m := Parse(lines, Options{Today: "2026-11-05"}); m != nil {
			t.Errorf("Parse(%q) = %+v, want nil", lines, m)
		}
	}
}
