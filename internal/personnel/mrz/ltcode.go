package mrz

// The Lithuanian personal code (asmens kodas), `G YYMMDD NNN K`: G gives the
// century and sex (1/2 the 1800s, 3/4 the 1900s, 5/6 the 2000s, odd male,
// even female), K is a check digit: the first ten digits weighted 1–9, 1
// modulo 11; if that is 10, weighted 3–9, 1, 2, 3 modulo 11; if that is 10
// again, 0. A code that begins with 9 (given to people whose birth date or
// sex was not known) passes its checksum but says nothing about either.

// LtPersonalCode is what a Lithuanian personal code says.
type LtPersonalCode struct {
	// Valid is whether the checksum passes.
	Valid bool `json:"valid"`
	// BirthDate is ISO; "" for a 9-code or an impossible date.
	BirthDate string `json:"birthDate,omitempty"`
	// Sex is M or F; "" for a 9-code.
	Sex string `json:"sex,omitempty"`
}

var (
	ltFirst  = [10]int{1, 2, 3, 4, 5, 6, 7, 8, 9, 1}
	ltSecond = [10]int{3, 4, 5, 6, 7, 8, 9, 1, 2, 3}
)

// ltCheckDigit is the check digit for the first ten digits of a code.
func ltCheckDigit(first10 string) int {
	sum := func(w [10]int) int {
		s := 0
		for i := 0; i < 10; i++ {
			s += int(first10[i]-'0') * w[i]
		}
		return s % 11
	}
	if a := sum(ltFirst); a != 10 {
		return a
	}
	if b := sum(ltSecond); b != 10 {
		return b
	}
	return 0
}

// ParseLtPersonalCode says what an 11-digit code says, and false when code
// is not 11 digits.
func ParseLtPersonalCode(code string) (LtPersonalCode, bool) {
	if !allDigits(code) || len(code) != 11 {
		return LtPersonalCode{}, false
	}
	out := LtPersonalCode{Valid: ltCheckDigit(code[:10]) == int(code[10]-'0')}
	g := int(code[0] - '0')
	if g < 1 || g > 6 {
		return out, true
	}
	year := 1800 + 100*((g-1)/2) + int(code[1]-'0')*10 + int(code[2]-'0')
	month := int(code[3]-'0')*10 + int(code[4]-'0')
	day := int(code[5]-'0')*10 + int(code[6]-'0')
	out.Sex = "F"
	if g%2 == 1 {
		out.Sex = "M"
	}
	if isRealDate(year, month, day) {
		out.BirthDate = iso(year, month, day)
	}
	return out, true
}

func allDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return s != ""
}
