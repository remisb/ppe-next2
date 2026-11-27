// Package releases serves and stores published apps' builds (ADR 0006
// phase 3, ADR 0009): the page of each version a channel opens at
// /apps/<slug>/…, with its profile's policy and the meta tags the app reads
// (Pages), and the files of each version under Config.Dir, written by
// Publish and removed by Prune. The registry of versions and channels is
// launcher.Service's; the host gives the policies, the meta tags' prefix and
// where builds are kept (Config), and its proxy serves the files
// (deploy/caddy/launcher.caddy).
package releases

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

// PagePattern is the route Pages answers; the host mounts it public: the app
// signs in itself, and what it reads is still guarded by the API.
const PagePattern = "GET /apps/{slug}/{rest...}"

// Policy is what a profile's page is sent: its Content-Security-Policy and
// Permissions-Policy (none when empty). The host's proxy sends the same with
// the profile's files.
type Policy struct{ CSP, Permissions string }

// Config is the host's for published apps.
type Config struct {
	// Dir holds the builds, <profile>/<slug>/<version>/; "" turns published
	// apps off (every page is 404, Publish and Prune are not run).
	Dir string
	// Policies has one entry per launcher.Profiles; a version whose profile
	// has none is refused, never given another's.
	Policies map[launcher.Profile]Policy
	// MetaPrefix names the page's meta tags, <prefix>-mount, -files,
	// -version and -channel, which the host's web apps read.
	MetaPrefix string
	// Republish says how to publish a version again whose files are missing,
	// for Prune's report; nil says nothing more.
	Republish func(slug, ref string) string
	// Limits bound a build; zero is DefaultLimits.
	Limits Limits
}

// Pages answers the pages of published apps: the host's proxy serves their
// files from Dir, Pages each channel's index.html, as its version wrote it
// but with its files' links made absolute and where it is mounted.
type Pages struct {
	apps *launcher.Service
	cfg  Config
	fail func(http.ResponseWriter, *http.Request, error)
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

// NewPages answers published apps' pages from apps' registry and cfg.Dir;
// fail answers an error the host's way.
func NewPages(apps *launcher.Service, cfg Config, fail func(http.ResponseWriter, *http.Request, error)) *Pages {
	return &Pages{apps: apps, cfg: cfg, fail: fail, epoch: strconv.FormatInt(time.Now().UnixNano(), 36), pages: map[uuid.UUID]string{}}
}

// relativeLink is a src or href Vite wrote relative to the page (base './').
var relativeLink = regexp.MustCompile(`((?:src|href)=")\./`)

// ServeHTTP answers what /apps/<slug>/<segment>… opens: the version's index.html
// with its links made absolute, its meta tags and its profile's policy, or
// 304 for the same ETag. An app with no Stable redirects to its tile's
// address when that is elsewhere; anything else that opens nothing, and
// every address without Config.Dir, is 404.
func (h *Pages) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	segment, _, _ := strings.Cut(r.PathValue("rest"), "/")
	if h.cfg.Dir == "" {
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
		h.fail(w, r, err)
		return
	}
	v := res.Version
	policy, ok := h.cfg.Policies[v.Profile]
	if !ok {
		h.fail(w, r, fmt.Errorf("published app %s %s: no policy for profile %q", slug, v.Version, v.Profile))
		return
	}
	hd := w.Header()
	hd.Set("Content-Type", "text/html; charset=utf-8")
	hd.Set("Cache-Control", "no-cache")
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Content-Security-Policy", policy.CSP)
	if policy.Permissions != "" {
		hd.Set("Permissions-Policy", policy.Permissions)
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
	page, err := h.rewritten(v, filepath.Join(h.cfg.Dir, string(v.Profile), slug, v.Version, "index.html"), files)
	if err != nil {
		hd.Del("ETag")
		h.fail(w, r, err)
		return
	}
	tag := func(name, content string) string {
		return `<meta name="` + h.cfg.MetaPrefix + `-` + name + `" content="` + html.EscapeString(content) + `">`
	}
	meta := tag("mount", res.Mount) + tag("files", files) + tag("version", v.Version) + tag("channel", res.Channel)
	out := strings.Replace(page, "</head>", meta+"</head>", 1)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(out))
}

// rewritten is a version's index.html with its links made absolute (files),
// from pages or read once. A page without </head> is an error, not a page
// without its meta tags (publishing refuses one).
func (h *Pages) rewritten(v launcher.Version, file, files string) (string, error) {
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
