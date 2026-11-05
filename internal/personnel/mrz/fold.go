package mrz

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Printed names and their MRZ form (docs-import plan §5.3): Fold maps a name
// as printed (`Žukauskaitė`, `Müller-Lüdenscheidt`, `Пётр`) to what the MRZ
// holds (`ZUKAUSKAITE`, `MUELLER<LUEDENSCHEIDT`, `PETR`), following ICAO Doc
// 9303 Part 3 §6. Where the table gives two forms (`Ä` as `AE` or `A`), both
// are returned; a state uses one of them throughout a name. NameMatch then
// says whether a typed name is the MRZ's, allowing for the MRZ cutting long
// names short. The same tables as @ppe/mrz's fold.ts.

// latin holds the Latin letters ICAO writes as more than their base letter,
// or as something other than it.
var latin = map[rune]string{
	'Æ': "AE", 'Ð': "D", 'Đ': "D", 'Ħ': "H", 'Ĳ': "IJ", 'Ł': "L", 'Ŀ': "L",
	'Œ': "OE", 'Ø': "OE", 'Þ': "TH", 'ẞ': "SS", 'ß': "SS",
}

// twoForms holds the letters with two forms: the expanded one (Germanic and
// Nordic practice) first, then the plain letter.
var twoForms = map[rune][2]string{'Ä': {"AE", "A"}, 'Ö': {"OE", "O"}, 'Ü': {"UE", "U"}, 'Å': {"AA", "A"}}

// cyrillic is ICAO 9303 Part 3, Table B. Ь is left out, as the table does.
var cyrillic = map[rune]string{
	'А': "A", 'Б': "B", 'В': "V", 'Г': "G", 'Ґ': "G", 'Д': "D", 'Ѓ': "G", 'Ђ': "D", 'Е': "E", 'Ё': "E", 'Є': "IE", 'Ж': "ZH", 'З': "Z",
	'Ѕ': "DZ", 'И': "I", 'І': "I", 'Ї': "I", 'Й': "I", 'Ј': "J", 'К': "K", 'Л': "L", 'Љ': "LJ", 'М': "M", 'Н': "N", 'Њ': "NJ", 'О': "O",
	'П': "P", 'Р': "R", 'С': "S", 'Т': "T", 'Ћ': "C", 'Ќ': "K", 'У': "U", 'Ў': "U", 'Ф': "F", 'Х': "KH", 'Ц': "TS", 'Ч': "CH", 'Џ': "DZ",
	'Ш': "SH", 'Щ': "SHCH", 'Ъ': "IE", 'Ы': "Y", 'Ь': "", 'Э': "E", 'Ю': "IU", 'Я': "IA",
}

// cyrillicUABY is where the table's notes differ by state: Belarus and
// Ukraine write Г as H, and Ukraine И as Y. A second Cyrillic reading, tried
// as a whole.
var cyrillicUABY = func() map[rune]string {
	m := make(map[rune]string, len(cyrillic))
	for k, v := range cyrillic {
		m[k] = v
	}
	m['Г'], m['И'] = "H", "Y"
	return m
}()

func isNameSeparator(r rune) bool {
	return unicode.IsSpace(r) || r == '-' || r == '‐' || r == '‑' || r == '–'
}

func foldWith(name string, form int, cyr map[rune]string) string {
	var out strings.Builder
	for _, ch := range strings.ToUpper(name) {
		if t, ok := twoForms[ch]; ok {
			out.WriteString(t[form])
		} else if s, ok := latin[ch]; ok {
			out.WriteString(s)
		} else if s, ok := cyr[ch]; ok {
			out.WriteString(s)
		} else if isNameSeparator(ch) {
			out.WriteByte('<')
		} else if ch >= 'A' && ch <= 'Z' {
			out.WriteRune(ch)
		} else {
			// Ą Č Ę Ė Į Š Ų Ū Ž and the rest: the letter without its marks.
			// Apostrophes, dots and anything else are left out (O'Brien → OBRIEN).
			var base strings.Builder
			for _, r := range norm.NFD.String(string(ch)) {
				if !unicode.Is(unicode.M, r) {
					base.WriteRune(r)
				}
			}
			if b := base.String(); b != "" && strings.Trim(b, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") == "" {
				out.WriteString(b)
			}
		}
	}
	s := out.String()
	for strings.Contains(s, "<<") {
		s = strings.ReplaceAll(s, "<<", "<")
	}
	return strings.TrimSuffix(strings.TrimPrefix(s, "<"), "<")
}

// Fold is every MRZ form of a printed name: one, or two where the name has a
// letter with two forms or is Cyrillic.
func Fold(name string) []string {
	forms := []string{foldWith(name, 0, cyrillic), foldWith(name, 1, cyrillic), foldWith(name, 0, cyrillicUABY)}
	var out []string
	seen := map[string]bool{}
	for _, f := range forms {
		if !seen[f] {
			seen[f] = true
			out = append(out, f)
		}
	}
	return out
}

// NameMatchResult is how printed names compare with the MRZ's name field.
type NameMatchResult string

const (
	NameSame      NameMatchResult = "same"
	NameTruncated NameMatchResult = "truncated"
	NameDiffers   NameMatchResult = "differs"
)

// NameMatch is whether the printed surname and given names are the MRZ's name
// field (fillers kept, as Mrz.NameField): same when a form of them fills the
// field exactly, truncated when the field is full and a form of them begins
// with it (the MRZ cut the name short), else differs.
func NameMatch(surname, givenNames, nameField string) NameMatchResult {
	n := len(nameField)
	truncated := false
	for _, s := range Fold(surname) {
		for _, g := range Fold(givenNames) {
			full := s
			if g != "" {
				full = s + "<<" + g
			}
			if len(full) <= n && full+strings.Repeat("<", n-len(full)) == nameField {
				return NameSame
			}
			if len(full) > n && strings.HasPrefix(full, nameField) {
				truncated = true
			}
			// ICAO's truncation may also cut a given name to its initial; a full field the
			// name's start matches up to its last part is taken as cut short too.
			if len(full) > n && !strings.HasSuffix(nameField, "<") && truncatedAtParts(full, nameField) {
				truncated = true
			}
		}
	}
	if truncated {
		return NameTruncated
	}
	return NameDiffers
}

// truncatedAtParts is whether the field is the full name with its later parts
// cut (each to at least its first letter).
func truncatedAtParts(full, field string) bool {
	parts := strings.Split(full, "<")
	got := strings.Split(field, "<")
	if len(got) > len(parts) {
		return false
	}
	for i, g := range got {
		if g == "" {
			if parts[i] != "" {
				return false
			}
		} else if !strings.HasPrefix(parts[i], g) {
			return false
		}
	}
	return true
}
