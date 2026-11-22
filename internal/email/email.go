// Package email is the one rule for an e-mail address the app stores: a
// user's sign-in, a supplier's contact and a SIM provider's address.
package email

import (
	"net/mail"
	"strings"
)

// MaxLen is an address's limit (RFC 5321's path).
const MaxLen = 254

// Valid tells whether s is one bare address (no display name, no list) of at
// most MaxLen bytes, with a domain that has a dot. Administration's forms ask
// for the same, so an address the API refuses is one they refuse too.
func Valid(s string) bool {
	if len(s) > MaxLen {
		return false
	}
	a, err := mail.ParseAddress(s)
	if err != nil || a.Address != s || a.Name != "" {
		return false
	}
	at := strings.LastIndexByte(s, '@')
	return at > 0 && strings.Contains(s[at+1:], ".")
}
