package main

import (
	"fmt"

	"github.com/remisb/ppe-next2/internal/domain/launcher"
	"github.com/remisb/ppe-next2/internal/launcher/releases"
)

// The policies a published app's page gets, by its version's profile. They
// are the ones deploy/Caddyfile sends with the staff app and with a profile's
// files (/apps/files/<profile>/…); TestPublishedPoliciesMatchCaddy keeps them
// equal. The one inline script, the theme, is the same in every app.
const (
	staffPolicy = "default-src 'self'; frame-src 'self' blob:; script-src 'self' 'sha256-AKRvWbdPuFGkTUGtgLGUciQLScPr+u526xsQQFr2xgU='; " +
		"style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; object-src 'none'; " +
		"base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
	// devicePolicy adds WebAssembly (no eval) and workers from the app's own files.
	devicePolicy = "default-src 'self'; frame-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval' 'sha256-AKRvWbdPuFGkTUGtgLGUciQLScPr+u526xsQQFr2xgU='; " +
		"worker-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; " +
		"object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
)

// profilePolicies has one entry per launcher.Profiles (TestEveryProfileHasAPolicy);
// a version whose profile has none is refused, never given the staff policy.
var profilePolicies = map[launcher.Profile]releases.Policy{
	launcher.ProfileStandard: {CSP: staffPolicy},
	launcher.ProfileDevice:   {CSP: devicePolicy, Permissions: "camera=(self)"},
}

// releasesConfig is published apps' configuration here: builds in
// API_APPS_DIR, this site's policies, the ppe- meta tags @ppe/routing reads,
// and make prod-publish to put a lost version's files back.
func releasesConfig(cfg config) releases.Config {
	return releases.Config{
		Dir:        cfg.AppsDir,
		Policies:   profilePolicies,
		MetaPrefix: "ppe",
		Republish: func(slug, ref string) string {
			return fmt.Sprintf("make prod-publish APP=%s REF=%s", slug, ref)
		},
	}
}

// registerPublishedAppRoutes mounts the public page route of published apps
// (/apps/<slug>/…, releases.Pages).
func registerPublishedAppRoutes(rt *router, svc *launcher.Service, cfg config) {
	rt.public(releases.PagePattern, releases.NewPages(svc, releasesConfig(cfg), writeError))
}
