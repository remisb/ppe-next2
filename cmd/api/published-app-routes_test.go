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

// The web image runs the Caddy CI's end-to-end tests run behind (and make
// e2e-caddy), not whichever caddy:2 is newest when the image is built.
func TestWebImageRunsCIsCaddy(t *testing.T) {
	ci, err := os.ReadFile("../../.github/workflows/ci.yml")
	if err != nil {
		t.Fatal(err)
	}
	dockerfile, err := os.ReadFile("../../web/Dockerfile")
	if err != nil {
		t.Fatal(err)
	}
	pinned := regexp.MustCompile(`CADDY_VERSION: (\S+)`).FindSubmatch(ci)
	image := regexp.MustCompile(`(?m)^ARG CADDY_VERSION=(\S+)$`).FindSubmatch(dockerfile)
	if pinned == nil || image == nil {
		t.Fatalf("CADDY_VERSION in ci.yml = %q, in web/Dockerfile = %q", pinned, image)
	}
	if string(pinned[1]) != string(image[1]) {
		t.Errorf("web/Dockerfile builds on Caddy %s, CI tests behind %s", image[1], pinned[1])
	}
	if !regexp.MustCompile(`(?m)^FROM caddy:\$\{CADDY_VERSION\}-alpine$`).Match(dockerfile) {
		t.Error("web/Dockerfile's Caddy stage is not caddy:${CADDY_VERSION}-alpine")
	}
}
