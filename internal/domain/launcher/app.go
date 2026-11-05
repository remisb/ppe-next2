// Package launcher is App Launcher's registry (ADR 0006, phase 2;
// docs/specs/app-launcher.md): every app and shortcut it shows, who sees each,
// each user's pinned tiles and the feedback people give on apps. An app is
// opened by its address; a shortcut opens one screen inside an app.
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

	"github.com/remisb/ppe-next2/internal/domain/role"
)

type Kind string

const (
	KindApp      Kind = "app"
	KindShortcut Kind = "shortcut"
)

// Group is where a tile sits in the launcher.
type Group string

var Groups = []Group{"workwear", "assets", "people", "admin"}

// Tier is where an app runs: here, on this origin with the user's sign-in, or
// linked, another site with its own (ADR 0006's sandbox tier is phase 4).
type Tier string

const (
	TierHere   Tier = "here"
	TierLinked Tier = "linked"
)

// Stage is how far along an app is. POC and In development are seen only
// with apps.preview; a retired tile by no one.
type Stage string

const (
	StageLive    Stage = "live"
	StagePilot   Stage = "pilot"
	StagePOC     Stage = "poc"
	StageDev     Stage = "dev"
	StageRetired Stage = "retired"
)

var Stages = []Stage{StageLive, StagePilot, StagePOC, StageDev, StageRetired}

// Icons are the pictures a tile may show; the launcher draws each.
var Icons = []string{
	"shirt", "order", "orders", "employees", "dashboard", "sim", "equipment", "scan", "crew", "admin", "help",
	"box", "flask", "pen", "check", "chart", "calendar", "truck", "wrench",
}

// Names is a tile's name in each language the apps speak.
type Names struct {
	EN string `json:"en"`
	LT string `json:"lt"`
	RU string `json:"ru"`
}

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
	// AnyOf: seen by a user holding any of these; none, by every signed-in user.
	AnyOf    []role.Permission `json:"any_of"`
	Position int               `json:"position"`
	// StableFollowsDeploys: a deploy's publish to Preview moves Stable too
	// (migration 0044); for a published app no one tries first.
	StableFollowsDeploys bool       `json:"stable_follows_deploys"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
	UpdatedByUserID      *uuid.UUID `json:"updated_by_user_id"`
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

type CreateParams struct {
	Slug string
	Kind Kind
	Fields
}

type UpdateParams struct {
	Fields
}

// ReservedSlugs are App Launcher's own paths under /apps/: its files and
// published builds' files, which deploy/Caddyfile serves before the API
// (cmd/api's TestReservedSlugsAreCaddys keeps them equal).
var ReservedSlugs = []string{"assets", "files"}

var (
	slugPattern  = regexp.MustCompile(`^[a-z][a-z0-9-]{1,30}$`)
	colorPattern = regexp.MustCompile(`^#[0-9a-f]{6}$`)
)

const (
	maxName = 60
	maxHref = 300
)

func (f *Fields) Normalize() {
	f.Parent = strings.TrimSpace(strings.ToLower(f.Parent))
	f.Icon = strings.TrimSpace(f.Icon)
	f.Color = strings.TrimSpace(strings.ToLower(f.Color))
	f.Href = strings.TrimSpace(f.Href)
	f.Names = Names{strings.TrimSpace(f.Names.EN), strings.TrimSpace(f.Names.LT), strings.TrimSpace(f.Names.RU)}
}

func (p *CreateParams) Normalize() {
	p.Slug = strings.TrimSpace(strings.ToLower(p.Slug))
	p.Fields.Normalize()
}

// Validate checks f for a tile of kind k; that a shortcut's parent exists is
// the service's to check.
func (f Fields) Validate(k Kind) error {
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
	if !slices.Contains(Groups, f.Group) {
		return fieldError("group", "is not a known group")
	}
	if !slices.Contains(Icons, f.Icon) {
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
	for lang, n := range map[string]string{"en": f.Names.EN, "lt": f.Names.LT, "ru": f.Names.RU} {
		if n == "" {
			return fieldError("names."+lang, "is required")
		}
		if utf8.RuneCountInString(n) > maxName {
			return fieldError("names."+lang, "is longer than "+strconv.Itoa(maxName)+" characters")
		}
	}
	for _, p := range f.AnyOf {
		if !role.IsKnown(p) {
			return fieldError("any_of", "names an unknown permission: "+p)
		}
	}
	return nil
}

func (p CreateParams) Validate() error {
	if !slugPattern.MatchString(p.Slug) {
		return fieldError("slug", "must be 2 to 31 lowercase letters, digits or hyphens, starting with a letter")
	}
	if slices.Contains(ReservedSlugs, p.Slug) {
		return fieldError("slug", "is taken by App Launcher's own addresses")
	}
	return p.Fields.Validate(p.Kind)
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

// anyOf is f's audience as stored: known permissions, in catalogue order.
func (f Fields) anyOf() []role.Permission { return role.Known(f.AnyOf) }

// Visible keeps the tiles a user with these permissions sees, in order: not
// retired; POC and In development only with apps.preview; the audience empty
// or one of its permissions held; a shortcut only when its app is seen.
func Visible(apps []App, can func(role.Permission) bool) []App {
	sees := func(a App) bool {
		if a.Stage == StageRetired {
			return false
		}
		if (a.Stage == StagePOC || a.Stage == StageDev) && !can(role.AppsPreview) {
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
