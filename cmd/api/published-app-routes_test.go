package main

import (
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/remisb/ppe-next2/internal/domain/launcher"
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

// Every profile has a page policy here and its files' handle in Caddy, and
// Caddy serves no profile's files the API does not know.
func TestEveryProfileHasAPolicy(t *testing.T) {
	caddyfile, err := os.ReadFile("../../deploy/Caddyfile")
	if err != nil {
		t.Fatal(err)
	}
	matcher := regexp.MustCompile(`(?m)^\s*@published path (.+)$`).FindSubmatch(caddyfile)
	if matcher == nil {
		t.Fatal("no @published matcher in deploy/Caddyfile")
	}
	var served []string
	for _, m := range regexp.MustCompile(`/apps/files/([^/\s]+)/\*`).FindAllSubmatch(matcher[1], -1) {
		served = append(served, string(m[1]))
	}
	var profiles []string
	for _, p := range launcher.Profiles {
		profiles = append(profiles, string(p))
		if pol, ok := profilePolicies[p]; !ok || pol.csp == "" {
			t.Errorf("profile %s has no page policy", p)
		}
	}
	if len(profilePolicies) != len(launcher.Profiles) {
		t.Errorf("%d page policies for %d profiles", len(profilePolicies), len(launcher.Profiles))
	}
	slices.Sort(served)
	slices.Sort(profiles)
	if !slices.Equal(served, profiles) {
		t.Errorf("Caddy serves the files of %v, the API knows %v", served, profiles)
	}
}

// The slugs App Launcher keeps for itself are exactly the /apps/<name>/ paths
// Caddy answers before handing /apps/* to the API: a slug Caddy took would
// never reach its app, and a path the API did not reserve could be an app's.
func TestReservedSlugsAreCaddys(t *testing.T) {
	caddyfile, err := os.ReadFile("../../deploy/Caddyfile")
	if err != nil {
		t.Fatal(err)
	}
	taken := map[string]bool{}
	for _, line := range strings.Split(string(caddyfile), "\n") {
		line = strings.TrimSpace(line)
		// Matchers and handles only: a redirect's target or a comment takes nothing.
		if !strings.HasPrefix(line, "@") && !strings.HasPrefix(line, "handle") {
			continue
		}
		for _, m := range regexp.MustCompile(`/apps/([^/\s*{]+)/`).FindAllStringSubmatch(line, -1) {
			taken[m[1]] = true
		}
	}
	var caddy []string
	for name := range taken {
		caddy = append(caddy, name)
	}
	slices.Sort(caddy)
	reserved := slices.Sorted(slices.Values(launcher.ReservedSlugs))
	if !slices.Equal(caddy, reserved) {
		t.Errorf("Caddy takes /apps/%v/, App Launcher reserves %v", caddy, reserved)
	}
}
