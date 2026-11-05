package launcher

import (
	"regexp"
	"slices"
	"strings"
	"time"

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

// The three channels an app may have. Named variants (a label and an audience
// of their own) were removed on 2026-11-05 (the handbook's P1: unused, and a
// variant could take a screen's address); migration 0047 dropped them.
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
	Commit       string    `json:"commit"`
	PublishedAt  time.Time `json:"published_at"`
	// PublishedByUserID is nil for a deploy's.
	PublishedByUserID *uuid.UUID `json:"published_by_user_id"`
}

// Channel is a name that points at one version of an app.
type Channel struct {
	ID        uuid.UUID `json:"id"`
	AppID     uuid.UUID `json:"app_id"`
	Name      string    `json:"name"`
	VersionID uuid.UUID `json:"version_id"`
	// Version and PublishedAt are its version's, read with it.
	Version         string     `json:"version"`
	PublishedAt     time.Time  `json:"published_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	UpdatedByUserID *uuid.UUID `json:"updated_by_user_id"`
}

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
	if p.Channel != "" && !slices.Contains(fixedChannels, p.Channel) {
		return fieldError("channel", "is not stable, beta or preview")
	}
	_, err := p.Manifest.ProfileOf()
	return err
}

// ChannelParams points a channel at one of the app's versions.
type ChannelParams struct {
	Version string
}

func (p *ChannelParams) Normalize() {
	p.Version = strings.TrimSpace(p.Version)
}

func (p ChannelParams) Validate(name string) error {
	if !slices.Contains(fixedChannels, name) {
		return fieldError("name", "is not stable, beta or preview")
	}
	return nil
}

// seesChannel: Stable is seen by whoever sees the tile, Beta and Preview by testers.
func seesChannel(c Channel, can func(role.Permission) bool) bool {
	return c.Name == ChannelStable || can(role.AppsPreview)
}
