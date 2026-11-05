// Package mrz parses the machine-readable zone of passports and ID cards
// (ICAO Doc 9303 Parts 3–6): TD1 (3 × 30), TD2 (2 × 36) and TD3 (2 × 44),
// their fields, check digits, the deterministic look-alike corrections of the
// docs-import plan's FR-5, the Lithuanian personal code, and the printed
// names' MRZ forms.
//
// It is the Go twin of web/packages/mrz (@ppe/mrz): the API parses again
// what the browser read and checks every digit itself (NFR-7). Both read
// testdata/mrz/vectors.json, so the two cannot drift apart; a rule changed in
// one is changed in the other and the vectors.
//
// Nothing read is ever put into an error or a message: problems and notes
// are codes with a field's name.
package mrz

// The check digit (ICAO Doc 9303 Part 3 §4.9): each character's value (`0`–`9`
// their own, `A`–`Z` 10–35, the filler `<` 0) times the weights 7, 3, 1
// repeating, the sum modulo 10.
//
// What it cannot see: two characters whose values differ by a multiple of 10
// give the same digit in any position. Of FR-5's look-alikes only `K` (20) and
// `<` (0) are such a pair, so the parser tells them apart by the layout.

// charValue is one MRZ character's value, and false for a character the MRZ
// never holds.
func charValue(c byte) (int, bool) {
	switch {
	case c == '<':
		return 0, true
	case c >= '0' && c <= '9':
		return int(c - '0'), true
	case c >= 'A' && c <= 'Z':
		return int(c-'A') + 10, true
	}
	return 0, false
}

// CheckDigit is s's check digit, and false when s holds a character the MRZ
// never holds.
func CheckDigit(s string) (int, bool) {
	weights := [3]int{7, 3, 1}
	sum := 0
	for i := 0; i < len(s); i++ {
		v, ok := charValue(s[i])
		if !ok {
			return 0, false
		}
		sum += v * weights[i%3]
	}
	return sum % 10, true
}

// checkDigitPasses is whether digit (one character) is s's check digit.
func checkDigitPasses(s string, digit byte) bool {
	d, ok := CheckDigit(s)
	return ok && digit == byte('0'+d)
}
