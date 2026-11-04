package main

import (
	"os"
	"regexp"
	"testing"
)

// The API sends a published app's page the policy Caddy sends with its
// profile's files: the staff app's, and the device profile's with the camera.
func TestPublishedPoliciesMatchCaddy(t *testing.T) {
	raw, err := os.ReadFile("../../deploy/Caddyfile")
	if err != nil {
		t.Fatal(err)
	}
	policy := func(matcher string) string {
		t.Helper()
		m := regexp.MustCompile(`header ` + matcher + `(?: \{\s*|\s+)Content-Security-Policy "([^"]+)"`).FindSubmatch(raw)
		if m == nil {
			t.Fatalf("no Content-Security-Policy for %s in deploy/Caddyfile", matcher)
		}
		return string(m[1])
	}
	if got := policy("@staffpolicy"); got != staffPolicy {
		t.Errorf("Caddy's staff policy\n%s\nthe API's\n%s", got, staffPolicy)
	}
	if got := policy("@devicepolicy"); got != devicePolicy {
		t.Errorf("Caddy's device policy\n%s\nthe API's\n%s", got, devicePolicy)
	}
}
