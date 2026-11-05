package launcher

import (
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/role"
)

// Profile is the policy a published version's pages and files get, chosen by
// the capabilities its manifest declares: a closed list, so a new one is a
// reviewed code change (and a Caddy handle).
type Profile string

const (
	ProfileStandard Profile = "standard"
	// ProfileDevice adds WebAssembly, workers from the app's own files and the camera.
	ProfileDevice Profile = "device"
)

// Profiles is every profile: each has a policy in cmd/api and a handle in
// deploy/Caddyfile (/apps/files/<profile>/*), which tests check.
var Profiles = []Profile{ProfileStandard, ProfileDevice}

// Capabilities are what a build may ask for beyond the staff app's policy.
var Capabilities = []string{"wasm", "workers", "camera"}

// ProfileOf is the profile for a build's capabilities: none is standard,
// any known one device, an unknown one an error.
func ProfileOf(caps []string) (Profile, error) {
	for _, c := range caps {
		if !slices.Contains(Capabilities, c) {
			return "", fieldError("capabilities", "names an unknown capability: "+c)
		}
	}
	if len(caps) == 0 {
		return ProfileStandard, nil
	}
	return ProfileDevice, nil
}

// The three fixed channels; any other name is a variant.
const (
	ChannelStable  = "stable"
	ChannelBeta    = "beta"
	ChannelPreview = "preview"
)

var fixedChannels = []string{ChannelStable, ChannelBeta, ChannelPreview}

// Version is one published build of an app, never changed once published.
type Version struct {
	ID           uuid.UUID `json:"id"`
	AppID        uuid.UUID `json:"app_id"`
	Version      string    `json:"version"`
	Profile      Profile   `json:"profile"`
	Capabilities []string  `json:"capabilities"`
	// Screens are the first-level screens its router uses (/apps/<slug>/<screen>):
	// no variant may be named like one.
	Screens     []string  `json:"screens"`
	Commit      string    `json:"commit"`
	PublishedAt time.Time `json:"published_at"`
	// PublishedByUserID is nil for a deploy's.
	PublishedByUserID *uuid.UUID `json:"published_by_user_id"`
}

// Channel is a name that points at one version of an app.
type Channel struct {
	ID    uuid.UUID `json:"id"`
	AppID uuid.UUID `json:"app_id"`
	Name  string    `json:"name"`
	// Label is a variant's name in each language; empty for the fixed channels.
	Label     Names     `json:"label"`
	VersionID uuid.UUID `json:"version_id"`
	// Version and PublishedAt are its version's, read with it.
	Version     string    `json:"version"`
	PublishedAt time.Time `json:"published_at"`
	// AnyOf: who sees it beside the tile's audience; none means testers. Stable follows the tile.
	AnyOf           []role.Permission `json:"any_of"`
	UpdatedAt       time.Time         `json:"updated_at"`
	UpdatedByUserID *uuid.UUID        `json:"updated_by_user_id"`
}

// IsVariant reports whether the channel is a named variant rather than a fixed one.
func (c Channel) IsVariant() bool { return !slices.Contains(fixedChannels, c.Name) }

var versionPattern = regexp.MustCompile(`^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9a-z][0-9a-z.-]{0,39}$`)

// ValidVersion reports whether v is a version's name, YYYY.MM.DD-<commit>.
func ValidVersion(v string) bool { return versionPattern.MatchString(v) }

// Manifest is a build's ppe-app.json: which app it is and what it needs.
type Manifest struct {
	Slug string `json:"slug"`
	// Profile names the build's policy (standard or device).
	Profile Profile `json:"profile"`
	// Capabilities are what builds declared before profile: each known one
	// means device. Still read, for older builds published from a git ref.
	Capabilities []string `json:"capabilities"`
	// Screens are the first-level path segments the app's router uses.
	Screens []string `json:"screens"`
}

// ProfileOf is the manifest's profile: its profile when it names one (and
// any capabilities it still lists must mean the same), else its capabilities'.
func (m Manifest) ProfileOf() (Profile, error) {
	if m.Profile == "" {
		return ProfileOf(m.Capabilities)
	}
	if !slices.Contains(Profiles, m.Profile) {
		return "", fieldError("profile", "is not a known profile: "+string(m.Profile))
	}
	if len(m.Capabilities) > 0 {
		if p, err := ProfileOf(m.Capabilities); err != nil || p != m.Profile {
			return "", fieldError("capabilities", "do not mean the profile it names, "+string(m.Profile))
		}
	}
	return m.Profile, nil
}

// maxScreens bounds a manifest's screens.
const maxScreens = 50

func (m Manifest) validateScreens() error {
	if len(m.Screens) > maxScreens {
		return fieldError("screens", "are too many")
	}
	seen := map[string]bool{}
	for _, s := range m.Screens {
		switch {
		case !slugPattern.MatchString(s):
			return fieldError("screens", "names "+s+", which is not a path segment like find")
		case slices.Contains(fixedChannels, s):
			return fieldError("screens", "names "+s+", a channel's address")
		case seen[s]:
			return fieldError("screens", "names "+s+" twice")
		}
		seen[s] = true
	}
	return nil
}

// PublishParams publishes a build of app Slug as Version, and points Channel
// at it ("" for none; an app with no Stable yet gets Stable too).
type PublishParams struct {
	Slug     string
	Version  string
	Commit   string
	Channel  string
	Manifest Manifest
}

func (p PublishParams) Validate() error {
	if !ValidVersion(p.Version) {
		return fieldError("version", "must be YYYY.MM.DD-<commit>")
	}
	if p.Manifest.Slug != p.Slug {
		return fieldError("manifest", "is for "+p.Manifest.Slug+", not "+p.Slug)
	}
	if p.Channel != "" && !slugPattern.MatchString(p.Channel) {
		return fieldError("channel", "is not a channel's name")
	}
	if _, err := p.Manifest.ProfileOf(); err != nil {
		return err
	}
	return p.Manifest.validateScreens()
}

// ChannelParams points a channel at a version and, for a variant, names it;
// any channel but Stable says who sees it (none: testers).
type ChannelParams struct {
	Version string
	Label   Names
	AnyOf   []string
}

func (p *ChannelParams) Normalize() {
	p.Version = strings.TrimSpace(p.Version)
	p.Label = Names{strings.TrimSpace(p.Label.EN), strings.TrimSpace(p.Label.LT), strings.TrimSpace(p.Label.RU)}
}

func (p ChannelParams) Validate(name string) error {
	if !slugPattern.MatchString(name) {
		return fieldError("name", "must be 2 to 31 lowercase letters, digits or hyphens, starting with a letter")
	}
	variant := !slices.Contains(fixedChannels, name)
	for lang, l := range map[string]string{"en": p.Label.EN, "lt": p.Label.LT, "ru": p.Label.RU} {
		if variant && l == "" {
			return fieldError("label."+lang, "is required for a variant")
		}
		if !variant && l != "" {
			return fieldError("label."+lang, "is only for a variant")
		}
		if utf8.RuneCountInString(l) > maxName {
			return fieldError("label."+lang, "is longer than 60 characters")
		}
	}
	if name == ChannelStable && len(p.AnyOf) > 0 {
		return fieldError("any_of", "of Stable is the tile's own")
	}
	for _, k := range p.AnyOf {
		if !role.IsKnown(k) {
			return fieldError("any_of", "names an unknown permission: "+k)
		}
	}
	return nil
}

// seesChannel: Stable is seen by whoever sees the tile; any other channel by
// holders of its permissions, or by testers when it names none.
func seesChannel(c Channel, can func(role.Permission) bool) bool {
	switch {
	case c.Name == ChannelStable:
		return true
	case len(c.AnyOf) == 0:
		return can(role.AppsPreview)
	default:
		return slices.ContainsFunc(c.AnyOf, can)
	}
}
