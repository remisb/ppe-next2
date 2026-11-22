package email

import (
	"strings"
	"testing"
)

func TestValid(t *testing.T) {
	long := strings.Repeat("a", MaxLen-len("@example.com")) + "@example.com"
	for s, want := range map[string]bool{
		"name@example.com":            true,
		"sim@telia.lt":                true,
		"first.last+tag@mail.co.uk":   true,
		long:                          true,
		"a" + long:                    false, // one byte over MaxLen
		"name@localhost":              false, // a domain without a dot
		"Name <name@example.com>":     false, // a display name
		"a@example.com, b@example.lt": false, // a list
		" name@example.com":           false, // untrimmed
		"name.example.com":            false,
		"name@":                       false,
		"":                            false,
	} {
		if got := Valid(s); got != want {
			t.Errorf("Valid(%q) = %v, want %v", s, got, want)
		}
	}
}
