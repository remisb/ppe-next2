package main

import (
	"errors"
	"fmt"
	"html"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/remisb/ppe-next2/internal/domain/launcher"
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

// pagePolicy is what a profile's page is sent: its Content-Security-Policy
// and Permissions-Policy (none for the standard profile).
type pagePolicy struct{ csp, permissions string }

// profilePolicies has one entry per launcher.Profiles (TestEveryProfileHasAPolicy);
// a version whose profile has none is refused, never given the staff policy.
var profilePolicies = map[launcher.Profile]pagePolicy{
	launcher.ProfileStandard: {csp: staffPolicy},
	launcher.ProfileDevice:   {csp: devicePolicy, permissions: "camera=(self)"},
}

// publishedApps answers the pages of apps published under /apps/<slug>/
// (ADR 0006, phase 3): Caddy serves their files from the published folder,
// the API each channel's index.html, as its version wrote it but with its
// files' links made absolute and where it is mounted. Public: the app signs
// in itself, and what it reads is still guarded by the API's permissions.
type publishedApps struct {
	apps *launcher.Service
	dir  string
}

func registerPublishedAppRoutes(rt *router, svc *launcher.Service, dir string) {
	h := &publishedApps{apps: svc, dir: dir}
	rt.public("GET /apps/{slug}/{rest...}", http.HandlerFunc(h.page))
}

// relativeLink is a src or href Vite wrote relative to the page (base './').
var relativeLink = regexp.MustCompile(`((?:src|href)=")\./`)

func (h *publishedApps) page(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	segment, _, _ := strings.Cut(r.PathValue("rest"), "/")
	if h.dir == "" {
		http.NotFound(w, r)
		return
	}
	res, err := h.apps.Resolve(r.Context(), slug, segment)
	switch {
	case errors.Is(err, launcher.ErrNotPublished):
		// An app on an address of its own, such as Administration.
		if res.App.Href != "/apps/"+slug+"/" {
			http.Redirect(w, r, res.App.Href, http.StatusFound)
			return
		}
		http.NotFound(w, r)
		return
	case errors.Is(err, launcher.ErrNotFound):
		http.NotFound(w, r)
		return
	case err != nil:
		writeError(w, r, err)
		return
	}
	v := res.Version
	policy, ok := profilePolicies[v.Profile]
	if !ok {
		writeError(w, r, fmt.Errorf("published app %s %s: no policy for profile %q", slug, v.Version, v.Profile))
		return
	}
	page, err := os.ReadFile(filepath.Join(h.dir, string(v.Profile), slug, v.Version, "index.html"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	files := "/apps/files/" + string(v.Profile) + "/" + slug + "/" + v.Version + "/"
	out := relativeLink.ReplaceAllString(string(page), "${1}"+files)
	meta := `<meta name="ppe-mount" content="` + html.EscapeString(res.Mount) + `">` +
		`<meta name="ppe-files" content="` + html.EscapeString(files) + `">` +
		`<meta name="ppe-version" content="` + html.EscapeString(v.Version) + `">` +
		`<meta name="ppe-channel" content="` + html.EscapeString(res.Channel) + `">`
	out = strings.Replace(out, "</head>", meta+"</head>", 1)

	hd := w.Header()
	hd.Set("Content-Type", "text/html; charset=utf-8")
	hd.Set("Cache-Control", "no-cache")
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Content-Security-Policy", policy.csp)
	if policy.permissions != "" {
		hd.Set("Permissions-Policy", policy.permissions)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(out))
}
