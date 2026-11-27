package launcher

import (
	"context"
	"errors"
	"maps"
	"slices"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// The audit events of a tile (entity type app; the Audit log's Settings
// area). The versions' are in service_versions.go.
const (
	EventRegistered      = "app.registered"
	EventChanged         = "app.changed"
	EventAudienceChanged = "app.audience_changed"
	EventMoved           = "app.moved"
	auditEntity          = "app"
)

// maxPins is how many tiles one user may pin.
const maxPins = 50

// positionStep is the gap between tiles' positions, so a new one goes last.
const positionStep = 10

// Service is App Launcher's registry: the tiles and who sees them, pins,
// feedback, and published apps' versions and channels (service_versions.go).
type Service struct {
	repo  Repository
	cfg   Config
	names UserNames
	now   func() time.Time
	newID func() uuid.UUID
	// slugs are the registered apps' slugs (shortcuts aside), for telling
	// requests' apps apart (X-PPE-App); Refresh loads them, Create adds one.
	slugs atomic.Pointer[map[string]bool]
}

// Option configures a Service.
type Option func(*Service)

// WithClock replaces the clock (UTC, microseconds, as Postgres stores them).
func WithClock(now func() time.Time) Option { return func(s *Service) { s.now = now } }

// WithUserNames names feedback's senders on Manage apps; without it they
// have no name.
func WithUserNames(names UserNames) Option { return func(s *Service) { s.names = names } }

// NewService is the registry over repo for the host's cfg; IsApp knows no
// slug until Refresh.
func NewService(repo Repository, cfg Config, opts ...Option) *Service {
	s := &Service{repo: repo, cfg: cfg, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New}
	for _, o := range opts {
		o(s)
	}
	s.slugs.Store(&map[string]bool{})
	return s
}

// Config is the host's configuration the registry was built with.
func (s *Service) Config() Config { return s.cfg }

// Refresh reads the registered apps' slugs again.
func (s *Service) Refresh(ctx context.Context) error {
	apps, err := s.repo.List(ctx)
	if err != nil {
		return err
	}
	m := map[string]bool{}
	for _, a := range apps {
		if a.Kind == KindApp {
			m[a.Slug] = true
		}
	}
	s.slugs.Store(&m)
	return nil
}

// IsApp reports whether slug is a registered app's, as last read.
func (s *Service) IsApp(slug string) bool { return (*s.slugs.Load())[slug] }

// addSlug adds a newly registered app's slug to slugs, as a new map: readers
// of the old one never see it change.
func (s *Service) addSlug(slug string) {
	for {
		cur := s.slugs.Load()
		next := make(map[string]bool, len(*cur)+1)
		for k := range *cur {
			next[k] = true
		}
		next[slug] = true
		if s.slugs.CompareAndSwap(cur, &next) {
			return
		}
	}
}

// List returns every tile by position, retired ones included (Manage apps).
func (s *Service) List(ctx context.Context) ([]App, error) { return s.repo.List(ctx) }

// Get returns the tile with the slug, retired or not (Manage apps).
func (s *Service) Get(ctx context.Context, slug string) (App, error) { return s.repo.Get(ctx, slug) }

// ForUser returns the tiles a user with these permissions sees and their pins
// among them, in the order pinned.
func (s *Service) ForUser(ctx context.Context, user uuid.UUID, can func(string) bool) ([]App, []string, error) {
	all, err := s.repo.List(ctx)
	if err != nil {
		return nil, nil, err
	}
	shown := Visible(all, can, s.cfg.Preview)
	pins, err := s.repo.Pins(ctx, user)
	if err != nil {
		return nil, nil, err
	}
	kept := make([]string, 0, len(pins))
	for _, p := range pins {
		if slices.ContainsFunc(shown, func(a App) bool { return a.Slug == p }) {
			kept = append(kept, p)
		}
	}
	return shown, kept, nil
}

// checkParent: a shortcut opens a screen in an app on this site.
func (s *Service) checkParent(ctx context.Context, k Kind, parent string) error {
	if k != KindShortcut {
		return nil
	}
	p, err := s.repo.Get(ctx, parent)
	if errors.Is(err, ErrNotFound) || (err == nil && (p.Kind != KindApp || p.Tier != TierHere)) {
		return fieldError("parent", "is not an app on this site")
	}
	return err
}

// Create registers a tile, last in the order, recording app.registered.
func (s *Service) Create(ctx context.Context, p CreateParams, actor uuid.UUID) (App, error) {
	p.Normalize()
	if actor == uuid.Nil {
		return App{}, fieldError("actor", "is required")
	}
	if err := p.Validate(s.cfg); err != nil {
		return App{}, err
	}
	if err := s.checkParent(ctx, p.Kind, p.Parent); err != nil {
		return App{}, err
	}
	all, err := s.repo.List(ctx)
	if err != nil {
		return App{}, err
	}
	pos := positionStep
	for _, a := range all {
		pos = max(pos, a.Position+positionStep)
	}
	now := s.now()
	a := App{
		ID: s.newID(), Slug: p.Slug, Kind: p.Kind, Parent: p.Parent, Group: p.Group, Icon: p.Icon, Color: p.Color,
		Href: p.Href, Tier: p.Tier, Stage: p.Stage, Names: p.Names, AnyOf: s.cfg.Known(p.AnyOf), Position: pos,
		CreatedAt: now, UpdatedAt: now, UpdatedByUserID: &actor,
	}
	ev, err := newEvent(s.newID(), &actor, EventRegistered, auditEntity, a.ID, now, nil, registered(a))
	if err != nil {
		return App{}, err
	}
	out, err := s.repo.Create(ctx, a, ev)
	if err == nil && out.Kind == KindApp {
		s.addSlug(out.Slug)
	}
	return out, err
}

// Update replaces a tile's fields: app.changed for what it shows and where,
// app.audience_changed for who sees it, each only when it changed.
func (s *Service) Update(ctx context.Context, slug string, p UpdateParams, actor uuid.UUID) (App, error) {
	p.Normalize()
	if actor == uuid.Nil {
		return App{}, fieldError("actor", "is required")
	}
	return s.repo.Update(ctx, slug, func(cur App) (App, []Event, error) {
		if err := p.Validate(cur.Kind, s.cfg); err != nil {
			return App{}, nil, err
		}
		if p.Parent != cur.Parent {
			if err := s.checkParent(ctx, cur.Kind, p.Parent); err != nil {
				return App{}, nil, err
			}
		}
		next := cur
		next.Parent, next.Group, next.Icon, next.Color = p.Parent, p.Group, p.Icon, p.Color
		next.Href, next.Tier, next.Stage, next.Names, next.AnyOf = p.Href, p.Tier, p.Stage, p.Names, s.cfg.Known(p.AnyOf)
		now := s.now()
		var evs []Event
		if before, after := shown(cur), shown(next); !maps.Equal(before, after) {
			ev, err := newEvent(s.newID(), &actor, EventChanged, auditEntity, cur.ID, now, before, after)
			if err != nil {
				return App{}, nil, err
			}
			evs = append(evs, ev)
		}
		if !slices.Equal(cur.AnyOf, next.AnyOf) {
			ev, err := newEvent(s.newID(), &actor, EventAudienceChanged, auditEntity, cur.ID, now,
				audience{cur.AnyOf}, audience{next.AnyOf})
			if err != nil {
				return App{}, nil, err
			}
			evs = append(evs, ev)
		}
		if len(evs) == 0 {
			return cur, nil, nil
		}
		next.UpdatedAt, next.UpdatedByUserID = now, &actor
		return next, evs, nil
	})
}

// Move puts a tile in front of another, or last when before is "", numbering
// every tile again 10, 20, 30…; app.moved records the moved tile's place.
func (s *Service) Move(ctx context.Context, slug, before string, actor uuid.UUID) ([]App, error) {
	if actor == uuid.Nil {
		return nil, fieldError("actor", "is required")
	}
	if before == slug {
		return nil, fieldError("before", "must be another tile")
	}
	return s.repo.Reorder(ctx, func(cur []App) ([]App, []Event, error) {
		from := slices.IndexFunc(cur, func(a App) bool { return a.Slug == slug })
		if from < 0 {
			return nil, nil, ErrNotFound
		}
		moved := cur[from]
		order := slices.Delete(slices.Clone(cur), from, from+1)
		at := len(order)
		if before != "" {
			if at = slices.IndexFunc(order, func(a App) bool { return a.Slug == before }); at < 0 {
				return nil, nil, fieldError("before", "is not a tile")
			}
		}
		order = slices.Insert(order, at, moved)
		if at == from {
			return nil, nil, nil
		}
		now := s.now()
		var changed []App
		for n, a := range order {
			if pos := (n + 1) * positionStep; a.Position != pos {
				a.Position = pos
				if a.Slug == slug {
					a.UpdatedAt, a.UpdatedByUserID = now, &actor
				}
				changed = append(changed, a)
			}
		}
		ev, err := newEvent(s.newID(), &actor, EventMoved, auditEntity, moved.ID, now, place{from + 1}, place{at + 1})
		if err != nil {
			return nil, nil, err
		}
		return changed, []Event{ev}, nil
	})
}

// SetPins replaces a user's pins with these tiles, in order; each must be one
// they see, at most once.
func (s *Service) SetPins(ctx context.Context, user uuid.UUID, slugs []string, can func(string) bool) ([]string, error) {
	if user == uuid.Nil {
		return nil, fieldError("user", "is required")
	}
	if len(slugs) > maxPins {
		return nil, fieldError("slugs", "has more than 50 tiles")
	}
	all, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	shown := Visible(all, can, s.cfg.Preview)
	ids := make([]uuid.UUID, 0, len(slugs))
	for i, slug := range slugs {
		if slices.Contains(slugs[:i], slug) {
			return nil, fieldError("slugs", "names "+slug+" twice")
		}
		at := slices.IndexFunc(shown, func(a App) bool { return a.Slug == slug })
		if at < 0 {
			return nil, fieldError("slugs", "names a tile you do not see: "+slug)
		}
		ids = append(ids, shown[at].ID)
	}
	if err := s.repo.SetPins(ctx, user, ids); err != nil {
		return nil, err
	}
	return slices.Clone(slugs), nil
}

// GiveFeedback stores feedback on an app the user sees.
func (s *Service) GiveFeedback(ctx context.Context, user uuid.UUID, p FeedbackParams, can func(string) bool) (Feedback, error) {
	p.Normalize()
	if user == uuid.Nil {
		return Feedback{}, fieldError("user", "is required")
	}
	if err := p.Validate(s.cfg.Languages); err != nil {
		return Feedback{}, err
	}
	all, err := s.repo.List(ctx)
	if err != nil {
		return Feedback{}, err
	}
	shown := Visible(all, can, s.cfg.Preview)
	at := slices.IndexFunc(shown, func(a App) bool { return a.Slug == p.App && a.Kind == KindApp })
	if at < 0 {
		return Feedback{}, ErrNotFound
	}
	version, err := s.openedVersion(ctx, user, shown[at], can)
	if err != nil {
		return Feedback{}, err
	}
	f := Feedback{
		ID: s.newID(), AppID: shown[at].ID, UserID: user, Rating: p.Rating, Text: p.Text,
		Device: p.Device, Language: p.Language, Version: version, CreatedAt: s.now(),
	}
	return f, s.repo.AddFeedback(ctx, f)
}

// Feedback returns the feedback on a tile, newest first, each with its
// sender's name (WithUserNames).
func (s *Service) Feedback(ctx context.Context, slug string) ([]Feedback, error) {
	a, err := s.repo.Get(ctx, slug)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.Feedback(ctx, a.ID)
	if err != nil || s.names == nil || len(list) == 0 {
		return list, err
	}
	ids := make([]uuid.UUID, 0, len(list))
	for _, f := range list {
		if !slices.Contains(ids, f.UserID) {
			ids = append(ids, f.UserID)
		}
	}
	names, err := s.names(ctx, ids)
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i].UserName = names[list[i].UserID]
	}
	return list, nil
}

// shown is what app.changed records: how a tile looks and where it opens,
// its name in each language as name_<language> (name_en, name_lt…).
func shown(a App) map[string]string {
	out := map[string]string{
		"parent": a.Parent, "group": string(a.Group), "icon": a.Icon, "color": a.Color,
		"href": a.Href, "tier": string(a.Tier), "stage": string(a.Stage),
	}
	for lang, n := range a.Names {
		out["name_"+lang] = n
	}
	return out
}

// audience is who sees a tile, as app.audience_changed records it.
type audience struct {
	AnyOf []string `json:"any_of"`
}

// place is a tile's place in the order, from 1, as app.moved records it.
type place struct {
	Place int `json:"place"`
}

// registered is a new tile as app.registered records it: its slug, kind,
// shown fields and audience.
func registered(a App) any {
	out := map[string]any{"slug": a.Slug, "kind": a.Kind, "any_of": a.AnyOf}
	for k, v := range shown(a) {
		out[k] = v
	}
	return out
}
