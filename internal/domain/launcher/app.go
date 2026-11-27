// Package launcher is App Launcher's registry (ADR 0006, phases 2 and 3;
// docs/specs/app-launcher.md): every app and shortcut it shows, who sees each,
// each user's pinned tiles and the feedback people give on apps, and the
// published apps' versions and channels (versions.go, service_versions.go).
// An app is opened by its address; a shortcut opens one screen inside an app.
package launcher

import (
	"math"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Kind is what a tile opens: an app, or one screen inside an app.
type Kind string

const (
	KindApp      Kind = "app"
	KindShortcut Kind = "shortcut"
)

// Group is where a tile sits in the launcher.
type Group string

// Tier is where an app runs: here, on this origin with the user's sign-in, or
// linked, another site with its own (ADR 0006's sandbox tier is phase 4).
type Tier string

const (
	TierHere   Tier = "here"
	TierLinked Tier = "linked"
)

// Stage is how far along an app is. POC and In development are seen only
// with Config.Preview; a retired tile by no one.
type Stage string

const (
	StageLive    Stage = "live"
	StagePilot   Stage = "pilot"
	StagePOC     Stage = "poc"
	StageDev     Stage = "dev"
	StageRetired Stage = "retired"
)

// Stages is every stage.
var Stages = []Stage{StageLive, StagePilot, StagePOC, StageDev, StageRetired}

// Names is a tile's name in each of Config.Languages, by language code.
type Names map[string]string

// App is one tile of the registry (launcher.apps): an app or
// a shortcut. Tiles are never deleted; Retired takes one away from everyone.
type App struct {
	ID   uuid.UUID `json:"id"`
	Slug string    `json:"slug"`
	Kind Kind      `json:"kind"`
	// Parent is the slug of the app a shortcut opens a screen in; "" for an app.
	Parent string `json:"parent"`
	Group  Group  `json:"group"`
	Icon   string `json:"icon"`
	// Color is the tile's, #rrggbb; white text on it passes 4.5:1.
	Color string `json:"color"`
	// Href is a path on this origin, or a linked site's https address.
	Href  string `json:"href"`
	Tier  Tier   `json:"tier"`
	Stage Stage  `json:"stage"`
	Names Names  `json:"names"`
	// AnyOf: seen by a user holding any of these host permissions; none, by
	// every signed-in user.
	AnyOf []string `json:"any_of"`
	// Position orders the tiles; Move numbers them again in steps of positionStep.
	Position int `json:"position"`
	// StableFollowsDeploys: a deploy's publish to Preview moves Stable too
	// (migration 0044); for a published app no one tries first.
	StableFollowsDeploys bool      `json:"stable_follows_deploys"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
	// UpdatedByUserID is nil while no administrator has changed the tile: a
	// default the code still owns (EnsureDefaults).
	UpdatedByUserID *uuid.UUID `json:"updated_by_user_id"`
}

// Fields are what Manage apps edits; the slug and kind are set once.
type Fields struct {
	Parent string
	Group  Group
	Icon   string
	Color  string
	Href   string
	Tier   Tier
	Stage  Stage
	Names  Names
	AnyOf  []string
}

// CreateParams registers a tile: its slug and kind, set once, and its fields.
type CreateParams struct {
	Slug string
	Kind Kind
	Fields
}

// UpdateParams replaces every field of a tile but its slug and kind.
type UpdateParams struct {
	Fields
}

// ReservedSlugs are App Launcher's own paths under /apps/: its files and
// published builds' files, which deploy/Caddyfile serves before the API
// (cmd/api's TestReservedSlugsAreCaddys keeps them equal).
var ReservedSlugs = []string{"assets", "files"}

// slugPattern is a tile's slug; @ppe/api-client's app-slugs.ts has the same
// rule (TestWebClientKeepsTheSlugRule). colorPattern is a tile's colour.
var (
	slugPattern  = regexp.MustCompile(`^[a-z][a-z0-9-]{1,30}$`)
	colorPattern = regexp.MustCompile(`^#[0-9a-f]{6}$`)
)

// maxName limits each name, in characters; maxHref an address, in bytes.
const (
	maxName = 60
	maxHref = 300
)

// Normalize trims every field and lowercases the parent and the colour.
func (f *Fields) Normalize() {
	f.Parent = strings.TrimSpace(strings.ToLower(f.Parent))
	f.Icon = strings.TrimSpace(f.Icon)
	f.Color = strings.TrimSpace(strings.ToLower(f.Color))
	f.Href = strings.TrimSpace(f.Href)
	names := make(Names, len(f.Names))
	for lang, n := range f.Names {
		names[strings.TrimSpace(strings.ToLower(lang))] = strings.TrimSpace(n)
	}
	f.Names = names
}

// Normalize trims and lowercases the slug and normalizes the fields.
func (p *CreateParams) Normalize() {
	p.Slug = strings.TrimSpace(strings.ToLower(p.Slug))
	p.Fields.Normalize()
}

// Validate checks f for a tile of kind k in the host's c; that a shortcut's
// parent exists is the service's to check.
func (f Fields) Validate(k Kind, c Config) error {
	switch k {
	case KindApp:
		if f.Parent != "" {
			return fieldError("parent", "is only for a shortcut")
		}
	case KindShortcut:
		if f.Parent == "" {
			return fieldError("parent", "is required for a shortcut")
		}
		if f.Tier != TierHere {
			return fieldError("tier", "of a shortcut is here: it opens a screen of an app on this site")
		}
	default:
		return fieldError("kind", "must be app or shortcut")
	}
	if !slices.Contains(c.Groups, f.Group) {
		return fieldError("group", "is not a known group")
	}
	if !slices.Contains(c.Icons, f.Icon) {
		return fieldError("icon", "is not a known picture")
	}
	if !colorPattern.MatchString(f.Color) {
		return fieldError("color", "must be #rrggbb")
	}
	if !readableOnWhiteText(f.Color) {
		return fieldError("color", "is too light for white text (it needs 4.5:1)")
	}
	if !slices.Contains(Stages, f.Stage) {
		return fieldError("stage", "is not a known stage")
	}
	if err := validHref(f.Tier, f.Href); err != nil {
		return err
	}
	if err := validNames(f.Names, c.Languages); err != nil {
		return err
	}
	for _, p := range f.AnyOf {
		if !c.IsKnown(p) {
			return fieldError("any_of", "names an unknown permission: "+p)
		}
	}
	return nil
}

// validNames: a name in each language, none longer than maxName, and no
// language the host does not speak.
func validNames(names Names, languages []string) error {
	for lang := range names {
		if !slices.Contains(languages, lang) {
			return fieldError("names."+lang, "is not a language of this site")
		}
	}
	for _, lang := range languages {
		n := names[lang]
		if n == "" {
			return fieldError("names."+lang, "is required")
		}
		if utf8.RuneCountInString(n) > maxName {
			return fieldError("names."+lang, "is longer than "+strconv.Itoa(maxName)+" characters")
		}
	}
	return nil
}

// Validate checks the slug (the pattern, and none of ReservedSlugs) and the
// fields for the tile's kind in the host's c.
func (p CreateParams) Validate(c Config) error {
	if !slugPattern.MatchString(p.Slug) {
		return fieldError("slug", "must be 2 to 31 lowercase letters, digits or hyphens, starting with a letter")
	}
	if slices.Contains(ReservedSlugs, p.Slug) {
		return fieldError("slug", "is taken by App Launcher's own addresses")
	}
	return p.Fields.Validate(p.Kind, c)
}

// validHref: a path on this origin for an app here (never //host, which would
// leave it), an https address with a host for a linked site.
func validHref(t Tier, href string) error {
	if href == "" {
		return fieldError("href", "is required")
	}
	if len(href) > maxHref || strings.ContainsAny(href, " \t\r\n\\") {
		return fieldError("href", "is not an address")
	}
	switch t {
	case TierHere:
		if !strings.HasPrefix(href, "/") || strings.HasPrefix(href, "//") {
			return fieldError("href", "of an app on this site is a path starting with /")
		}
	case TierLinked:
		u, err := url.Parse(href)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
			return fieldError("href", "of a linked site is an https address")
		}
	default:
		return fieldError("tier", "must be here or linked")
	}
	return nil
}

// readableOnWhiteText reports whether white text on c (#rrggbb) has a
// contrast of at least 4.5:1, WCAG's for normal text.
func readableOnWhiteText(c string) bool {
	channel := func(hex string) float64 {
		v, _ := strconv.ParseUint(hex, 16, 8)
		s := float64(v) / 255
		if s <= 0.04045 {
			return s / 12.92
		}
		return math.Pow((s+0.055)/1.055, 2.4)
	}
	l := 0.2126*channel(c[1:3]) + 0.7152*channel(c[3:5]) + 0.0722*channel(c[5:7])
	return 1.05/(l+0.05) >= 4.5
}

// Visible keeps the tiles a user with these permissions sees, in order: not
// retired; POC and In development only with the preview permission; the
// audience empty or one of its permissions held; a shortcut only when its
// app is seen.
func Visible(apps []App, can func(string) bool, preview string) []App {
	sees := func(a App) bool {
		if a.Stage == StageRetired {
			return false
		}
		if (a.Stage == StagePOC || a.Stage == StageDev) && !can(preview) {
			return false
		}
		return len(a.AnyOf) == 0 || slices.ContainsFunc(a.AnyOf, can)
	}
	seen := map[string]bool{}
	for _, a := range apps {
		if a.Kind == KindApp && sees(a) {
			seen[a.Slug] = true
		}
	}
	out := make([]App, 0, len(apps))
	for _, a := range apps {
		if (a.Kind == KindApp && seen[a.Slug]) || (a.Kind == KindShortcut && seen[a.Parent] && sees(a)) {
			out = append(out, a)
		}
	}
	return out
}
