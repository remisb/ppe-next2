package mrz

import "fmt"

// The MRZ's dates are YYMMDD, without their century. The rules that give it,
// the same in @ppe/mrz:
//
//   - a birth date is in the past: 20YY unless that is after today, then 19YY;
//   - an expiry date is at most 50 years ahead: 20YY unless that is more than
//     50 years after today's year, then 19YY (a document expired long ago).
//
// Today is always passed in (an ISO date), so the rules are pure and the test
// vectors fix it.

type dateKind int

const (
	birth dateKind = iota
	expiry
)

// mrzDate is the ISO date (YYYY-MM-DD) a YYMMDD stands for, and "" when it is
// not a date (`<` for an unknown day or month included).
func mrzDate(yymmdd string, kind dateKind, today string) string {
	if len(yymmdd) != 6 {
		return ""
	}
	for i := 0; i < 6; i++ {
		if yymmdd[i] < '0' || yymmdd[i] > '9' {
			return ""
		}
	}
	num := func(s string) int { return int(s[0]-'0')*10 + int(s[1]-'0') }
	yy, mm, dd := num(yymmdd[0:2]), num(yymmdd[2:4]), num(yymmdd[4:6])
	if !isRealDate(2000+yy, mm, dd) && !isRealDate(1900+yy, mm, dd) {
		return ""
	}
	thisYear := 0
	if _, err := fmt.Sscanf(today, "%4d", &thisYear); err != nil {
		return ""
	}
	year := 2000 + yy
	if kind == birth {
		if iso(year, mm, dd) > today {
			year = 1900 + yy
		}
	} else if year > thisYear+50 {
		year = 1900 + yy
	}
	// 29 February of a year that has none (the other century's had one).
	if !isRealDate(year, mm, dd) {
		return ""
	}
	return iso(year, mm, dd)
}

func isRealDate(year, month, day int) bool {
	if month < 1 || month > 12 || day < 1 {
		return false
	}
	days := [12]int{31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}[month-1]
	if month == 2 && isLeap(year) {
		days = 29
	}
	return day <= days
}

func isLeap(y int) bool { return (y%4 == 0 && y%100 != 0) || y%400 == 0 }

func iso(year, month, day int) string { return fmt.Sprintf("%04d-%02d-%02d", year, month, day) }
