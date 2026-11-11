package employee

import (
	"slices"
	"strings"

	"github.com/remisb/ppe-next2/internal/personnel/mrz"
)

// MatchKind is how alike two employees' names are (docs/specs/employee-service.md,
// "Duplicates and merging").
type MatchKind string

const (
	// SameName: the same words once folded, in any order ("Jonas Petraitis",
	// "PETRAITIS JONAS", "Jonas Petraitis" with accents or in Cyrillic).
	SameName MatchKind = "same_name"
	// SimilarName: at least two words match, allowing a slip of a letter or
	// two, and they are at least two thirds of the longer name's words
	// ("Abhijith Palanil Sajeevan", "PALANJIL SAJEEVAN ABHIJITH"). Two
	// common words alone ("Islam Mohammad Mahmudul", "Sumon Mohammad
	// Tohidul Islam") are not enough.
	SimilarName MatchKind = "similar_name"
)

// Match is an employee whose name is like the one asked about.
type Match struct {
	Employee Employee  `json:"employee"`
	Kind     MatchKind `json:"kind"`
}

// nameWords is a name's words folded as an identity document's MRZ holds
// them (mrz.Fold: no accents, Cyrillic transliterated, upper case), so
// "Žukauskaitė" and "ZUKAUSKAITE" are one word.
func nameWords(first, last string) []string {
	folded := mrz.Fold(first + " " + last)[0]
	var words []string
	for w := range strings.SplitSeq(folded, "<") {
		if w != "" {
			words = append(words, w)
		}
	}
	return words
}

// CompareNames says how alike two names are; false when they are not alike.
func CompareNames(aFirst, aLast, bFirst, bLast string) (MatchKind, bool) {
	return compareWords(nameWords(aFirst, aLast), nameWords(bFirst, bLast))
}

func compareWords(a, b []string) (MatchKind, bool) {
	if len(a) == 0 || len(b) == 0 {
		return "", false
	}
	if sa, sb := slices.Sorted(slices.Values(a)), slices.Sorted(slices.Values(b)); slices.Equal(sa, sb) {
		return SameName, true
	}
	shorter, longer := a, b
	if len(b) < len(a) {
		shorter, longer = b, a
	}
	used := make([]bool, len(longer))
	matched := 0
	// Exact words first, so a near one never takes a word another matches exactly.
	pending := make([]string, 0, len(shorter))
	for _, w := range shorter {
		if i := slices.IndexFunc(longer, func(x string) bool { return x == w }); i >= 0 && !used[i] {
			used[i] = true
			matched++
			continue
		}
		pending = append(pending, w)
	}
	for _, w := range pending {
		for i, x := range longer {
			if !used[i] && nearWords(w, x) {
				used[i] = true
				matched++
				break
			}
		}
	}
	if matched >= 2 && matched*3 >= len(longer)*2 {
		return SimilarName, true
	}
	return "", false
}

// nearWords: words of four letters or more may differ by one letter (added,
// left out, changed or two swapped), of seven or more by two. Shorter words
// must be equal: "Ana" and "Ina" are different people.
func nearWords(a, b string) bool {
	n := min(len(a), len(b))
	switch {
	case n >= 7:
		return editDistance(a, b) <= 2
	case n >= 4:
		return editDistance(a, b) <= 1
	}
	return false
}

// editDistance is the optimal string alignment distance of two ASCII words
// (what nameWords gives): insertions, deletions, substitutions and swaps of
// neighbouring letters.
func editDistance(a, b string) int {
	if a == b {
		return 0
	}
	prev2 := make([]int, len(b)+1)
	prev := make([]int, len(b)+1)
	cur := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		cur[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
			if i > 1 && j > 1 && a[i-1] == b[j-2] && a[i-2] == b[j-1] {
				cur[j] = min(cur[j], prev2[j-2]+1)
			}
		}
		prev2, prev, cur = prev, cur, prev2
	}
	return prev[len(b)]
}

// Pair is two live employees who may be one person, the older first.
type Pair struct {
	A    Employee  `json:"a"`
	B    Employee  `json:"b"`
	Kind MatchKind `json:"kind"`
}
