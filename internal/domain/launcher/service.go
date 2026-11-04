package launcher

import (
	"context"
	"errors"
	"slices"
	"sync/atomic"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/role"
)

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

type Service struct {
	repo  Repository
	now   func() time.Time
	newID func() uuid.UUID
	// slugs are the registered apps' slugs (shortcuts aside), for telling
	// requests' apps apart (X-PPE-App); Refresh loads them, Create adds one.
	slugs atomic.Pointer[map[string]bool]
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{repo: repo, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New}
	for _, o := range opts {
		o(s)
	}
	s.slugs.Store(&map[string]bool{})
	return s
}

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

func (s *Service) Get(ctx context.Context, slug string) (App, error) { return s.repo.Get(ctx, slug) }

// ForUser returns the tiles a user with these permissions sees and their pins
// among them, in the order pinned.
func (s *Service) ForUser(ctx context.Context, user uuid.UUID, can func(role.Permission) bool) ([]App, []string, error) {
	all, err := s.repo.List(ctx)
	if err != nil {
		return nil, nil, err
	}
	shown := Visible(all, can)
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
	if err := p.Validate(); err != nil {
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
		Href: p.Href, Tier: p.Tier, Stage: p.Stage, Names: p.Names, AnyOf: p.anyOf(), Position: pos,
		CreatedAt: now, UpdatedAt: now, UpdatedByUserID: &actor,
	}
	ev, err := audit.New(s.newID(), &actor, EventRegistered, auditEntity, a.ID, now, nil, registered(a))
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
	return s.repo.Update(ctx, slug, func(cur App) (App, []audit.Event, error) {
		if err := p.Validate(cur.Kind); err != nil {
			return App{}, nil, err
		}
		if p.Parent != cur.Parent {
			if err := s.checkParent(ctx, cur.Kind, p.Parent); err != nil {
				return App{}, nil, err
			}
		}
		next := cur
		next.Parent, next.Group, next.Icon, next.Color = p.Parent, p.Group, p.Icon, p.Color
		next.Href, next.Tier, next.Stage, next.Names, next.AnyOf = p.Href, p.Tier, p.Stage, p.Names, p.anyOf()
		now := s.now()
		var evs []audit.Event
		if before, after := shown(cur), shown(next); before != after {
			ev, err := audit.New(s.newID(), &actor, EventChanged, auditEntity, cur.ID, now, before, after)
			if err != nil {
				return App{}, nil, err
			}
			evs = append(evs, ev)
		}
		if !slices.Equal(cur.AnyOf, next.AnyOf) {
			ev, err := audit.New(s.newID(), &actor, EventAudienceChanged, auditEntity, cur.ID, now,
				audience{role.Strings(cur.AnyOf)}, audience{role.Strings(next.AnyOf)})
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
	return s.repo.Reorder(ctx, func(cur []App) ([]App, []audit.Event, error) {
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
		ev, err := audit.New(s.newID(), &actor, EventMoved, auditEntity, moved.ID, now, place{from + 1}, place{at + 1})
		if err != nil {
			return nil, nil, err
		}
		return changed, []audit.Event{ev}, nil
	})
}

// SetPins replaces a user's pins with these tiles, in order; each must be one
// they see, at most once.
func (s *Service) SetPins(ctx context.Context, user uuid.UUID, slugs []string, can func(role.Permission) bool) ([]string, error) {
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
	shown := Visible(all, can)
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
func (s *Service) GiveFeedback(ctx context.Context, user uuid.UUID, p FeedbackParams, can func(role.Permission) bool) (Feedback, error) {
	p.Normalize()
	if user == uuid.Nil {
		return Feedback{}, fieldError("user", "is required")
	}
	if err := p.Validate(); err != nil {
		return Feedback{}, err
	}
	all, err := s.repo.List(ctx)
	if err != nil {
		return Feedback{}, err
	}
	at := slices.IndexFunc(Visible(all, can), func(a App) bool { return a.Slug == p.App && a.Kind == KindApp })
	if at < 0 {
		return Feedback{}, ErrNotFound
	}
	f := Feedback{
		ID: s.newID(), AppID: Visible(all, can)[at].ID, UserID: user, Rating: p.Rating, Text: p.Text,
		Device: p.Device, Language: p.Language, CreatedAt: s.now(),
	}
	return f, s.repo.AddFeedback(ctx, f)
}

// Feedback returns the feedback on a tile, newest first.
func (s *Service) Feedback(ctx context.Context, slug string) ([]Feedback, error) {
	a, err := s.repo.Get(ctx, slug)
	if err != nil {
		return nil, err
	}
	return s.repo.Feedback(ctx, a.ID)
}

// shownFields is what app.changed records: how a tile looks and where it opens.
type shownFields struct {
	Parent string `json:"parent"`
	Group  Group  `json:"group"`
	Icon   string `json:"icon"`
	Color  string `json:"color"`
	Href   string `json:"href"`
	Tier   Tier   `json:"tier"`
	Stage  Stage  `json:"stage"`
	NameEN string `json:"name_en"`
	NameLT string `json:"name_lt"`
	NameRU string `json:"name_ru"`
}

func shown(a App) shownFields {
	return shownFields{a.Parent, a.Group, a.Icon, a.Color, a.Href, a.Tier, a.Stage, a.Names.EN, a.Names.LT, a.Names.RU}
}

type audience struct {
	AnyOf []string `json:"any_of"`
}

type place struct {
	Place int `json:"place"`
}

// registered is a new tile as app.registered records it.
func registered(a App) any {
	return struct {
		Slug string `json:"slug"`
		Kind Kind   `json:"kind"`
		shownFields
		AnyOf []string `json:"any_of"`
	}{a.Slug, a.Kind, shown(a), role.Strings(a.AnyOf)}
}
