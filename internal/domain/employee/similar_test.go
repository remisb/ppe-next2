package employee

import "testing"

func TestCompareNames(t *testing.T) {
	tests := []struct {
		name          string
		aFirst, aLast string
		bFirst, bLast string
		want          MatchKind
		alike         bool
	}{
		// The pair found on production: other order, capitals, one letter more.
		{"production pair", "Abhijith", "Palanil Sajeevan", "PALANJIL", "SAJEEVAN ABHIJITH", SimilarName, true},
		{"same words, other order", "Jonas", "Petraitis", "PETRAITIS", "JONAS", SameName, true},
		{"accents", "Rūta", "Žukauskaitė", "Ruta", "Zukauskaite", SameName, true},
		{"cyrillic", "Пётр", "Иванов", "Petr", "Ivanov", SameName, true},
		{"words split differently", "Anna Marija", "Kazlauskienė", "Anna", "Marija Kazlauskiene", SameName, true},
		{"one slip in a long surname", "Andrius", "Kazlauskas", "Andrius", "Kazlauskis", SimilarName, true},
		{"swapped letters", "Tomas", "Petraitis", "Tomas", "Petriatis", SimilarName, true},
		{"third name missing", "Abhijith", "Palanil Sajeevan", "Abhijith", "Sajeevan", SimilarName, true},
		{"married surname is another person", "Jonas", "Jonaitis", "Jonas", "Jonaitienė", "", false},
		{"same first name only", "Jonas", "Kazlauskas", "Jonas", "Petraitis", "", false},
		{"same surname only", "Jonas", "Kazlauskas", "Tomas", "Kazlauskas", "", false},
		{"short names must be equal", "Ana", "Li", "Ina", "Lu", "", false},
		{"two common words of four", "ISLAM MOHAMMAD", "MAHMUDUL", "SUMON MOHAMMAD", "TOHIDUL ISLAM", "", false},
		{"one of three", "Abhijith", "Palanil Sajeevan", "Abhijith", "Kumar Nair", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, alike := CompareNames(tt.aFirst, tt.aLast, tt.bFirst, tt.bLast)
			if got != tt.want || alike != tt.alike {
				t.Errorf("CompareNames = %q, %v; want %q, %v", got, alike, tt.want, tt.alike)
			}
			// The comparison is symmetric.
			back, alikeBack := CompareNames(tt.bFirst, tt.bLast, tt.aFirst, tt.aLast)
			if back != got || alikeBack != alike {
				t.Errorf("reversed = %q, %v; want %q, %v", back, alikeBack, got, alike)
			}
		})
	}
}

func TestEditDistance(t *testing.T) {
	tests := []struct {
		a, b string
		want int
	}{
		{"PALANIL", "PALANJIL", 1},
		{"PETRAITIS", "PETRIATIS", 1},
		{"JONAITIS", "JONAITIENE", 3},
		{"", "ABC", 3},
		{"ABC", "ABC", 0},
	}
	for _, tt := range tests {
		if got := editDistance(tt.a, tt.b); got != tt.want {
			t.Errorf("editDistance(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
		}
	}
}
