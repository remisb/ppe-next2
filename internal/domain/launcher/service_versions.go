package launcher

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/role"
)

const (
	EventVersionPublished = "app.version_published"
	EventChannelMoved     = "app.channel_moved"
	EventChannelChanged   = "app.channel_changed"
	EventVersionsPruned   = "app.versions_pruned"
)

// KeepVersions is how many of an app's newest versions Prune keeps besides
// those a channel points at.
const KeepVersions = 5

// publishable is an app whose builds the API serves under /apps/<slug>/.
func publishable(a App) error {
	if a.Kind != KindApp || a.Tier != TierHere {
		return fieldError("slug", "is not an app on this site")
	}
	return nil
}

// Version returns an app's published version by name, and whether it exists.
func (s *Service) Version(ctx context.Context, slug, version string) (Version, bool, error) {
	a, err := s.repo.Get(ctx, slug)
	if err != nil {
		return Version{}, false, err
	}
	all, err := s.repo.Versions(ctx, a.ID)
	if err != nil {
		return Version{}, false, err
	}
	at := slices.IndexFunc(all, func(v Version) bool { return v.Version == version })
	if at < 0 {
		return Version{}, false, nil
	}
	return all[at], true, nil
}

// CheckPublish says whether p can be published: before its files are put in
// place, so a build that would be refused leaves none behind.
func (s *Service) CheckPublish(ctx context.Context, p PublishParams) (App, error) {
	if err := p.Validate(); err != nil {
		return App{}, err
	}
	a, err := s.repo.Get(ctx, p.Slug)
	if err != nil {
		return App{}, err
	}
	return a, publishable(a)
}

// Publish records a published build (app.version_published), unless that
// version is recorded already, and points p.Channel at it; an app with no
// Stable yet gets Stable too, and so does an app whose Stable follows deploys
// when it goes to Preview. Actor is nil for a deploy's.
func (s *Service) Publish(ctx context.Context, p PublishParams, actor *uuid.UUID) (Version, error) {
	p.Slug, p.Channel = strings.TrimSpace(p.Slug), strings.TrimSpace(p.Channel)
	a, err := s.CheckPublish(ctx, p)
	if err != nil {
		return Version{}, err
	}
	v, found, err := s.Version(ctx, p.Slug, p.Version)
	if err != nil {
		return Version{}, err
	}
	if !found {
		profile, _ := ProfileOf(p.Manifest.Capabilities)
		v = Version{
			ID: s.newID(), AppID: a.ID, Version: p.Version, Profile: profile, Capabilities: slices.Clone(p.Manifest.Capabilities),
			Commit: p.Commit, PublishedAt: s.now(), PublishedByUserID: actor,
		}
		if v.Capabilities == nil {
			v.Capabilities = []string{}
		}
		ev, err := audit.New(s.newID(), actor, EventVersionPublished, auditEntity, a.ID, v.PublishedAt, nil,
			published{v.Version, v.Profile, v.Capabilities, v.Commit})
		if err != nil {
			return Version{}, err
		}
		if err := s.repo.AddVersion(ctx, v, ev); err != nil {
			return Version{}, err
		}
	}
	channels, err := s.appChannels(ctx, a.ID)
	if err != nil {
		return Version{}, err
	}
	targets := []string{}
	if !slices.ContainsFunc(channels, func(c Channel) bool { return c.Name == ChannelStable }) ||
		(a.StableFollowsDeploys && p.Channel == ChannelPreview) {
		targets = append(targets, ChannelStable)
	}
	if p.Channel != "" && !slices.Contains(targets, p.Channel) {
		if !slices.Contains(fixedChannels, p.Channel) && !slices.ContainsFunc(channels, func(c Channel) bool { return c.Name == p.Channel }) {
			return Version{}, fieldError("channel", "is not one of the app's channels: add the variant on Manage apps first")
		}
		targets = append(targets, p.Channel)
	}
	for _, name := range targets {
		if _, err := s.repo.PutChannel(ctx, a.ID, name, s.pointAt(a, name, v, actor, nil)); err != nil {
			return Version{}, err
		}
	}
	return v, nil
}

// SetStableFollowsDeploys turns on or off whether a deploy's publish to
// Preview moves Stable too (app.changed, with stable_follows_deploys).
func (s *Service) SetStableFollowsDeploys(ctx context.Context, slug string, on bool, actor uuid.UUID) (App, error) {
	if actor == uuid.Nil {
		return App{}, fieldError("actor", "is required")
	}
	return s.repo.Update(ctx, slug, func(cur App) (App, []audit.Event, error) {
		if err := publishable(cur); err != nil {
			return App{}, nil, err
		}
		if cur.StableFollowsDeploys == on {
			return cur, nil, nil
		}
		now := s.now()
		ev, err := audit.New(s.newID(), &actor, EventChanged, auditEntity, cur.ID, now, follows{cur.StableFollowsDeploys}, follows{on})
		if err != nil {
			return App{}, nil, err
		}
		next := cur
		next.StableFollowsDeploys, next.UpdatedAt, next.UpdatedByUserID = on, now, &actor
		return next, []audit.Event{ev}, nil
	})
}

// AppVersion is one of an app's published versions, with the app's slug:
// where its files are (<profile>/<slug>/<version>).
type AppVersion struct {
	Slug    string
	Version Version
}

// Recorded is every published version of every app, for finding files no
// version names.
func (s *Service) Recorded(ctx context.Context) ([]AppVersion, error) {
	apps, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	out := []AppVersion{}
	for _, a := range apps {
		if a.Kind != KindApp {
			continue
		}
		versions, err := s.repo.Versions(ctx, a.ID)
		if err != nil {
			return nil, err
		}
		for _, v := range versions {
			out = append(out, AppVersion{a.Slug, v})
		}
	}
	return out, nil
}

// Prune removes, from every app, the versions no channel points at beyond
// the newest KeepVersions (app.versions_pruned, by no one), and returns them
// so their files can go. A version's address then answers 404.
func (s *Service) Prune(ctx context.Context) ([]AppVersion, error) {
	apps, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	out := []AppVersion{}
	for _, a := range apps {
		if a.Kind != KindApp {
			continue
		}
		removed, err := s.repo.PruneVersions(ctx, a.ID, func(versions []Version, channels []Channel) ([]Version, *audit.Event, error) {
			var remove []Version
			names := []string{}
			for i, v := range versions {
				if i < KeepVersions || slices.ContainsFunc(channels, func(c Channel) bool { return c.VersionID == v.ID }) {
					continue
				}
				remove = append(remove, v)
				names = append(names, v.Version)
			}
			if len(remove) == 0 {
				return nil, nil, nil
			}
			ev, err := audit.New(s.newID(), nil, EventVersionsPruned, auditEntity, a.ID, s.now(), nil, pruned{names})
			return remove, &ev, err
		})
		if err != nil {
			return nil, err
		}
		for _, v := range removed {
			out = append(out, AppVersion{a.Slug, v})
		}
	}
	return out, nil
}

// pointAt points a channel at v (app.channel_moved when it moves), keeping
// its label and audience, or setting them when p is given.
func (s *Service) pointAt(a App, name string, v Version, actor *uuid.UUID, p *ChannelParams) ChannelMutation {
	return func(cur *Channel) (Channel, []audit.Event, error) {
		now := s.now()
		next := Channel{ID: s.newID(), AppID: a.ID, Name: name, AnyOf: []role.Permission{}}
		if cur != nil {
			next = *cur
		}
		var evs []audit.Event
		if p != nil {
			label, anyOf := p.Label, role.Known(p.AnyOf)
			if cur != nil && (label != cur.Label || !slices.Equal(anyOf, cur.AnyOf)) {
				ev, err := audit.New(s.newID(), actor, EventChannelChanged, auditEntity, a.ID, now,
					shownAs(name, cur.Label, cur.AnyOf), shownAs(name, label, anyOf))
				if err != nil {
					return Channel{}, nil, err
				}
				evs = append(evs, ev)
			}
			next.Label, next.AnyOf = label, anyOf
		}
		if cur == nil || cur.VersionID != v.ID {
			var before any
			if cur != nil {
				before = channelAt{name, cur.Version}
			}
			ev, err := audit.New(s.newID(), actor, EventChannelMoved, auditEntity, a.ID, now, before, channelAt{name, v.Version})
			if err != nil {
				return Channel{}, nil, err
			}
			evs = append(evs, ev)
		}
		if len(evs) == 0 {
			return *cur, nil, nil
		}
		next.VersionID, next.Version, next.PublishedAt = v.ID, v.Version, v.PublishedAt
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		return next, evs, nil
	}
}

// PointChannel points one of an app's channels at a version, as Manage apps
// promotes, rolls back or adds a variant, with its label and audience.
func (s *Service) PointChannel(ctx context.Context, slug, name string, p ChannelParams, actor uuid.UUID) (Channel, error) {
	p.Normalize()
	if actor == uuid.Nil {
		return Channel{}, fieldError("actor", "is required")
	}
	if err := p.Validate(name); err != nil {
		return Channel{}, err
	}
	a, err := s.repo.Get(ctx, slug)
	if err != nil {
		return Channel{}, err
	}
	if err := publishable(a); err != nil {
		return Channel{}, err
	}
	v, found, err := s.Version(ctx, slug, p.Version)
	if err != nil {
		return Channel{}, err
	}
	if !found {
		return Channel{}, fieldError("version", "is not a published version of "+slug)
	}
	return s.repo.PutChannel(ctx, a.ID, name, s.pointAt(a, name, v, &actor, &p))
}

func (s *Service) appChannels(ctx context.Context, app uuid.UUID) ([]Channel, error) {
	all, err := s.repo.Channels(ctx)
	if err != nil {
		return nil, err
	}
	out := []Channel{}
	for _, c := range all {
		if c.AppID == app {
			out = append(out, c)
		}
	}
	return out, nil
}

// Releases returns an app's versions, newest first, and its channels, for Manage apps.
func (s *Service) Releases(ctx context.Context, slug string) ([]Version, []Channel, error) {
	a, err := s.repo.Get(ctx, slug)
	if err != nil {
		return nil, nil, err
	}
	versions, err := s.repo.Versions(ctx, a.ID)
	if err != nil {
		return nil, nil, err
	}
	channels, err := s.appChannels(ctx, a.ID)
	return versions, channels, err
}

// ChannelsFor returns, for the apps a user sees, the channels they see (each
// app's in the channels' order: Stable, Beta, Preview, then variants) and the
// one they chose, by slug; an app with no channels is left out.
func (s *Service) ChannelsFor(ctx context.Context, user uuid.UUID, apps []App, can func(role.Permission) bool) (map[string][]Channel, map[string]string, error) {
	all, err := s.repo.Channels(ctx)
	if err != nil {
		return nil, nil, err
	}
	chosen, err := s.repo.Choices(ctx, user)
	if err != nil {
		return nil, nil, err
	}
	seen := map[string][]Channel{}
	choices := map[string]string{}
	for _, a := range apps {
		for _, c := range all {
			if c.AppID == a.ID && seesChannel(c, can) {
				seen[a.Slug] = append(seen[a.Slug], c)
			}
		}
		if name := chosen[a.ID]; name != "" && slices.ContainsFunc(seen[a.Slug], func(c Channel) bool { return c.Name == name }) {
			choices[a.Slug] = name
		}
	}
	return seen, choices, nil
}

// ChooseChannel keeps the channel a user opens an app on, one they see;
// Stable (or "") is the default and removes the choice.
func (s *Service) ChooseChannel(ctx context.Context, user uuid.UUID, slug, name string, can func(role.Permission) bool) error {
	if user == uuid.Nil {
		return fieldError("user", "is required")
	}
	all, err := s.repo.List(ctx)
	if err != nil {
		return err
	}
	shown := Visible(all, can)
	at := slices.IndexFunc(shown, func(a App) bool { return a.Slug == slug && a.Kind == KindApp })
	if at < 0 {
		return ErrNotFound
	}
	a := shown[at]
	if name == "" || name == ChannelStable {
		return s.repo.SetChoice(ctx, user, a.ID, "")
	}
	channels, err := s.appChannels(ctx, a.ID)
	if err != nil {
		return err
	}
	if !slices.ContainsFunc(channels, func(c Channel) bool { return c.Name == name && seesChannel(c, can) }) {
		return fieldError("channel", "is not one of the app's channels you see")
	}
	return s.repo.SetChoice(ctx, user, a.ID, name)
}

// Trial is one version of a published app as its Trials view reads it: when
// it was published, the channels opening it and the feedback given on it.
// Who used it and its errors are Usage's and System's.
type Trial struct {
	Version     string    `json:"version"`
	PublishedAt time.Time `json:"published_at"`
	// Channels are those opening it, with a variant's label.
	Channels []Channel      `json:"channels"`
	Feedback FeedbackCounts `json:"feedback"`
}

// FeedbackCounts counts feedback by rating.
type FeedbackCounts struct {
	Works     int `json:"works"`
	Confusing int `json:"confusing"`
	Broken    int `json:"broken"`
}

// Trials returns an app's versions, newest first, each with the channels
// opening it and its feedback (feedback from before versions were recorded,
// or on an app with none, counts for no version).
func (s *Service) Trials(ctx context.Context, slug string) ([]Trial, error) {
	versions, channels, err := s.Releases(ctx, slug)
	if err != nil {
		return nil, err
	}
	a, err := s.repo.Get(ctx, slug)
	if err != nil {
		return nil, err
	}
	feedback, err := s.repo.Feedback(ctx, a.ID)
	if err != nil {
		return nil, err
	}
	out := make([]Trial, 0, len(versions))
	for _, v := range versions {
		t := Trial{Version: v.Version, PublishedAt: v.PublishedAt, Channels: []Channel{}}
		for _, c := range channels {
			if c.VersionID == v.ID {
				t.Channels = append(t.Channels, c)
			}
		}
		for _, f := range feedback {
			if f.Version == nil || *f.Version != v.Version {
				continue
			}
			switch f.Rating {
			case "works":
				t.Feedback.Works++
			case "confusing":
				t.Feedback.Confusing++
			case "broken":
				t.Feedback.Broken++
			}
		}
		out = append(out, t)
	}
	return out, nil
}

// openedVersion is the version a's tile opens for the user: their chosen
// channel's, if they still see it, else Stable's; nil for an app with no
// versions. Feedback is given on it.
func (s *Service) openedVersion(ctx context.Context, user uuid.UUID, a App, can func(role.Permission) bool) (*string, error) {
	seen, chosen, err := s.ChannelsFor(ctx, user, []App{a}, can)
	if err != nil {
		return nil, err
	}
	name := chosen[a.Slug]
	if name == "" {
		name = ChannelStable
	}
	at := slices.IndexFunc(seen[a.Slug], func(c Channel) bool { return c.Name == name })
	if at < 0 {
		return nil, nil
	}
	v := seen[a.Slug][at].Version
	return &v, nil
}

// Resolved is what an address under /apps/<slug>/ opens: the app, the
// version, the channel ("@<version>" for one opened by its version) and
// where the app is mounted.
type Resolved struct {
	App     App
	Version Version
	Channel string
	Mount   string
}

// ErrNotPublished is an app on this site with no published Stable: it lives
// at its own address.
var ErrNotPublished = errors.New("app not published")

// Resolve finds what /apps/<slug>/<segment>… opens: segment "@<version>" is
// that version, a channel's name that channel, anything else (an app's own
// screen, or nothing) Stable.
func (s *Service) Resolve(ctx context.Context, slug, segment string) (Resolved, error) {
	a, err := s.repo.Get(ctx, slug)
	if err != nil {
		return Resolved{}, err
	}
	if a.Kind != KindApp || a.Stage == StageRetired {
		return Resolved{}, ErrNotFound
	}
	versions, err := s.repo.Versions(ctx, a.ID)
	if err != nil {
		return Resolved{}, err
	}
	byID := func(id uuid.UUID) (Version, bool) {
		at := slices.IndexFunc(versions, func(v Version) bool { return v.ID == id })
		if at < 0 {
			return Version{}, false
		}
		return versions[at], true
	}
	base := "/apps/" + a.Slug + "/"
	if name, ok := strings.CutPrefix(segment, "@"); ok {
		at := slices.IndexFunc(versions, func(v Version) bool { return v.Version == name })
		if at < 0 {
			return Resolved{}, ErrNotFound
		}
		return Resolved{App: a, Version: versions[at], Channel: segment, Mount: base + segment + "/"}, nil
	}
	channels, err := s.appChannels(ctx, a.ID)
	if err != nil {
		return Resolved{}, err
	}
	pick := func(name, mount string) (Resolved, bool) {
		at := slices.IndexFunc(channels, func(c Channel) bool { return c.Name == name })
		if at < 0 {
			return Resolved{}, false
		}
		v, ok := byID(channels[at].VersionID)
		return Resolved{App: a, Version: v, Channel: name, Mount: mount}, ok
	}
	if segment != "" && segment != ChannelStable {
		if r, ok := pick(segment, base+segment+"/"); ok {
			return r, nil
		}
	}
	mount := base
	if segment == ChannelStable {
		mount = base + ChannelStable + "/"
	}
	if r, ok := pick(ChannelStable, mount); ok {
		return r, nil
	}
	return Resolved{App: a}, ErrNotPublished
}

type published struct {
	Version      string   `json:"version"`
	Profile      Profile  `json:"profile"`
	Capabilities []string `json:"capabilities"`
	Commit       string   `json:"commit"`
}

type follows struct {
	StableFollowsDeploys bool `json:"stable_follows_deploys"`
}

type pruned struct {
	Versions []string `json:"versions"`
}

type channelAt struct {
	Channel string `json:"channel"`
	Version string `json:"version"`
}

type channelShown struct {
	Channel string   `json:"channel"`
	LabelEN string   `json:"label_en"`
	LabelLT string   `json:"label_lt"`
	LabelRU string   `json:"label_ru"`
	AnyOf   []string `json:"any_of"`
}

func shownAs(name string, label Names, anyOf []role.Permission) channelShown {
	return channelShown{name, label.EN, label.LT, label.RU, role.Strings(anyOf)}
}
