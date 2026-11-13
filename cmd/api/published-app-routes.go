package main

import (
	"errors"
	"fmt"
	"html"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

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
	// epoch tells this process's pages from an earlier one's in their ETags,
	// so a deploy that changes the policies or the meta tags is never a 304.
	epoch string

	mu sync.Mutex
	// pages holds each version's index.html with its links made absolute,
	// read and rewritten once: a version never changes. Emptied when full.
	pages map[uuid.UUID]string
}

// maxCachedPages bounds pages: a few apps, each with a handful of versions a channel opens.
const maxCachedPages = 64

// registerPublishedAppRoutes mounts the public page route of published apps
// (/apps/<slug>/…); dir is API_APPS_DIR.
func registerPublishedAppRoutes(rt *router, svc *launcher.Service, dir string) {
	h := &publishedApps{apps: svc, dir: dir, epoch: strconv.FormatInt(time.Now().UnixNano(), 36), pages: map[uuid.UUID]string{}}
	rt.public("GET /apps/{slug}/{rest...}", http.HandlerFunc(h.page))
}

// relativeLink is a src or href Vite wrote relative to the page (base './').
var relativeLink = regexp.MustCompile(`((?:src|href)=")\./`)

// page answers what /apps/<slug>/<segment>… opens: the version's index.html
// with its links made absolute, its meta tags and its profile's policy, or
// 304 for the same ETag. An app with no Stable redirects to its tile's
// address when that is elsewhere; anything else that opens nothing, and
// every address without API_APPS_DIR, is 404.
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
	hd := w.Header()
	hd.Set("Content-Type", "text/html; charset=utf-8")
	hd.Set("Cache-Control", "no-cache")
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Content-Security-Policy", policy.csp)
	if policy.permissions != "" {
		hd.Set("Permissions-Policy", policy.permissions)
	}
	// The page at this address is this version's, as this process writes it:
	// unchanged until a channel moves (another version) or the API restarts.
	etag := `"` + v.ID.String() + "." + h.epoch + `"`
	hd.Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	files := "/apps/files/" + string(v.Profile) + "/" + slug + "/" + v.Version + "/"
	page, err := h.rewritten(v, filepath.Join(h.dir, string(v.Profile), slug, v.Version, "index.html"), files)
	if err != nil {
		hd.Del("ETag")
		writeError(w, r, err)
		return
	}
	meta := `<meta name="ppe-mount" content="` + html.EscapeString(res.Mount) + `">` +
		`<meta name="ppe-files" content="` + html.EscapeString(files) + `">` +
		`<meta name="ppe-version" content="` + html.EscapeString(v.Version) + `">` +
		`<meta name="ppe-channel" content="` + html.EscapeString(res.Channel) + `">`
	out := strings.Replace(page, "</head>", meta+"</head>", 1)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(out))
}

// rewritten is a version's index.html with its links made absolute (files),
// from pages or read once. A page without </head> is an error, not a page
// without its meta tags (publishing refuses one).
func (h *publishedApps) rewritten(v launcher.Version, file, files string) (string, error) {
	h.mu.Lock()
	page, ok := h.pages[v.ID]
	h.mu.Unlock()
	if ok {
		return page, nil
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		return "", err
	}
	if !strings.Contains(string(raw), "</head>") {
		return "", fmt.Errorf("published app %s: index.html has no </head>", v.Version)
	}
	page = relativeLink.ReplaceAllString(string(raw), "${1}"+files)
	h.mu.Lock()
	if len(h.pages) >= maxCachedPages {
		clear(h.pages)
	}
	h.pages[v.ID] = page
	h.mu.Unlock()
	return page, nil
}
