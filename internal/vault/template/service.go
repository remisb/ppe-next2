package template

import (
	"context"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/vault"
)

// The templates' audit events (docs/specs/document-template-service.md).
const (
	EventCreated    = "document_template.created"
	EventUpdated    = "document_template.updated"
	EventDraftSaved = "document_template.draft_saved"
	EventPublished  = "document_template.published"
	EventRetired    = "document_template.retired"
	// Entity is a template's audit entity type.
	Entity = "document_template"
)

// Events are every event this package writes.
func Events() []string {
	return []string{EventCreated, EventUpdated, EventDraftSaved, EventPublished, EventRetired}
}

// Languages are the templates' languages: how dates and money are written.
var Languages = []string{"lt", "en", "ru"}

// Version states.
const (
	Draft     = "draft"
	Published = "published"
)

// Version is one version of a template's text.
type Version struct {
	Number      int        `json:"number"`
	State       string     `json:"state"`
	Body        Body       `json:"body"`
	Asked       []Asked    `json:"asked"`
	BodySHA256  string     `json:"body_sha256"`
	UpdatedAt   time.Time  `json:"updated_at"`
	PublishedAt *time.Time `json:"published_at"`
}

// Template is a document type's template: its name and language, its draft
// and the version Generate uses.
type Template struct {
	ID       uuid.UUID `json:"id"`
	Type     string    `json:"type"`
	Name     string    `json:"name"`
	Language string    `json:"language"`
	// Current is the published version Generate uses; nil before the first.
	Current *int `json:"current_version"`
	// Retired templates are not offered by Generate.
	Retired   bool       `json:"retired"`
	RetiredAt *time.Time `json:"retired_at,omitempty"`
	// Versions are every version, newest first: the draft (if any) and the published ones.
	Versions        []Version  `json:"versions"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	CreatedByUserID uuid.UUID  `json:"created_by_user_id"`
	UpdatedByUserID uuid.UUID  `json:"updated_by_user_id"`
	DeletedAt       *time.Time `json:"-"`
}

// Draft is the template's draft, if it has one.
func (t Template) Draft() (Version, bool) {
	i := slices.IndexFunc(t.Versions, func(v Version) bool { return v.State == Draft })
	if i < 0 {
		return Version{}, false
	}
	return t.Versions[i], true
}

// Published is the version Generate uses, if any.
func (t Template) Published() (Version, bool) {
	if t.Current == nil {
		return Version{}, false
	}
	i := slices.IndexFunc(t.Versions, func(v Version) bool { return v.Number == *t.Current })
	if i < 0 {
		return Version{}, false
	}
	return t.Versions[i], true
}

// Mutation computes a template's change from its locked state: the
// template, the version to write (nil for none) and the events.
type Mutation func(cur Template) (Template, *Version, []audit.Event, error)

// Repository is the templates' persistence; reads return live templates.
type Repository interface {
	Create(ctx context.Context, t Template, v Version, ev audit.Event) error
	Get(ctx context.Context, id uuid.UUID) (Template, error)
	List(ctx context.Context) ([]Template, error)
	// Update locks the template, applies m and writes it, its version (a
	// draft saved, or published) and the events.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (Template, error)
}

// Service holds the templates' use cases.
type Service struct {
	repo  Repository
	now   func() time.Time
	newID func() uuid.UUID
}

// Option configures a Service.
type Option func(*Service)

// WithClock replaces the clock.
func WithClock(now func() time.Time) Option { return func(s *Service) { s.now = now } }

// NewService is the template service over repo.
func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{repo: repo, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New}
	for _, o := range opts {
		o(s)
	}
	return s
}

func (s *Service) event(actor uuid.UUID, name string, id uuid.UUID, at time.Time, before, after any) (audit.Event, error) {
	return audit.New(s.newID(), &actor, name, Entity, id, at, before, after)
}

// Details are a template's name and language.
type Details struct {
	Type     string `json:"type"`
	Name     string `json:"name"`
	Language string `json:"language"`
}

func (d *Details) check(creating bool) error {
	d.Name = strings.Join(strings.Fields(d.Name), " ")
	if creating {
		t, ok := vault.TypeOf(d.Type)
		if !ok || !t.Allows(vault.Generated) {
			return fieldError("type", "is not a type documents are generated for")
		}
	}
	switch {
	case d.Name == "" || utf8.RuneCountInString(d.Name) > 120:
		return fieldError("name", "needs 1 to 120 characters")
	case !slices.Contains(Languages, d.Language):
		return fieldError("language", "must be lt, en or ru")
	}
	return nil
}

// Generatable are the types a template may be made for.
func Generatable() []vault.Type {
	var out []vault.Type
	for _, t := range vault.Types() {
		if t.Allows(vault.Generated) {
			out = append(out, t)
		}
	}
	return out
}

// starter is a new template's first draft.
func starter(name string) Body {
	return Body{Format: Format, Blocks: []Block{
		{Type: Heading, Level: 1, Text: []Run{{Text: name + " "}, {Field: "document.number"}}},
		{Type: Paragraph, Text: []Run{{Field: "company.name"}, {Text: ", "}, {Field: "document.date"}}},
	}}
}

// Create adds a template of a generatable type, with a first draft.
func (s *Service) Create(ctx context.Context, d Details, actor uuid.UUID) (Template, error) {
	if actor == uuid.Nil {
		return Template{}, fieldError("actor", "is required")
	}
	if err := d.check(true); err != nil {
		return Template{}, err
	}
	now := s.now()
	t := Template{ID: s.newID(), Type: d.Type, Name: d.Name, Language: d.Language, CreatedAt: now, UpdatedAt: now, CreatedByUserID: actor, UpdatedByUserID: actor}
	body := starter(d.Name)
	sum, err := Hash(body, []Asked{})
	if err != nil {
		return Template{}, err
	}
	v := Version{Number: 1, State: Draft, Body: body, Asked: []Asked{}, BodySHA256: sum, UpdatedAt: now}
	ev, err := s.event(actor, EventCreated, t.ID, now, nil, map[string]any{"type": d.Type, "name": d.Name, "language": d.Language})
	if err != nil {
		return Template{}, err
	}
	if err := s.repo.Create(ctx, t, v, ev); err != nil {
		return Template{}, err
	}
	return s.repo.Get(ctx, t.ID)
}

// Get is the live template.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Template, error) {
	return s.repo.Get(ctx, id)
}

// List is every live template, by type then name.
func (s *Service) List(ctx context.Context) ([]Template, error) { return s.repo.List(ctx) }

// Update renames a template or changes its language (the next published
// version writes dates in it; published ones keep theirs through their documents' text).
func (s *Service) Update(ctx context.Context, id uuid.UUID, d Details, actor uuid.UUID) (Template, error) {
	if err := d.check(false); err != nil {
		return Template{}, err
	}
	return s.repo.Update(ctx, id, func(cur Template) (Template, *Version, []audit.Event, error) {
		if cur.Name == d.Name && cur.Language == d.Language {
			return cur, nil, nil, nil
		}
		now := s.now()
		next := cur
		next.Name, next.Language, next.UpdatedAt, next.UpdatedByUserID = d.Name, d.Language, now, actor
		ev, err := s.event(actor, EventUpdated, id, now, map[string]any{"name": cur.Name, "language": cur.Language},
			map[string]any{"name": d.Name, "language": d.Language})
		return next, nil, []audit.Event{ev}, err
	})
}

// check checks a body and its asked fields, as a draft may be: every field known.
func check(body Body, asked []Asked) error {
	if err := CheckAsked(asked); err != nil {
		return err
	}
	return body.Check(func(k string) bool { return Known(k, asked) })
}

// SaveDraft saves body and asked as the template's draft, starting one
// after the newest version when there is none.
func (s *Service) SaveDraft(ctx context.Context, id uuid.UUID, body Body, asked []Asked, actor uuid.UUID) (Template, error) {
	if asked == nil {
		asked = []Asked{}
	}
	if err := check(body, asked); err != nil {
		return Template{}, err
	}
	sum, err := Hash(body, asked)
	if err != nil {
		return Template{}, err
	}
	return s.repo.Update(ctx, id, func(cur Template) (Template, *Version, []audit.Event, error) {
		draft, ok := cur.Draft()
		if ok && draft.BodySHA256 == sum {
			return cur, nil, nil, nil
		}
		if !ok {
			draft = Version{Number: 1, State: Draft}
			if len(cur.Versions) > 0 {
				draft.Number = cur.Versions[0].Number + 1
			}
		}
		now := s.now()
		draft.Body, draft.Asked, draft.BodySHA256, draft.UpdatedAt = body, asked, sum, now
		next := cur
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		ev, err := s.event(actor, EventDraftSaved, id, now, nil, map[string]any{"version": draft.Number, "body_sha256": sum})
		return next, &draft, []audit.Event{ev}, err
	})
}

// Publish makes the draft the version Generate uses, never to change again:
// it must name {{document.number}}, so every generated document prints its number.
func (s *Service) Publish(ctx context.Context, id uuid.UUID, actor uuid.UUID) (Template, error) {
	return s.repo.Update(ctx, id, func(cur Template) (Template, *Version, []audit.Event, error) {
		draft, ok := cur.Draft()
		if !ok {
			return cur, nil, nil, fieldError("draft", "is missing: save one first")
		}
		if err := check(draft.Body, draft.Asked); err != nil {
			return cur, nil, nil, err
		}
		if !slices.Contains(draft.Body.FieldKeys(), "document.number") {
			return cur, nil, nil, fieldError("body", "must print {{document.number}}")
		}
		now := s.now()
		draft.State, draft.PublishedAt = Published, &now
		next := cur
		next.Current, next.UpdatedAt, next.UpdatedByUserID = &draft.Number, now, actor
		next.Retired, next.RetiredAt = false, nil
		ev, err := s.event(actor, EventPublished, id, now, nil, map[string]any{"version": draft.Number, "body_sha256": draft.BodySHA256})
		return next, &draft, []audit.Event{ev}, err
	})
}

// Retire hides the template from Generate; its documents keep naming it.
// Publishing a new version brings it back.
func (s *Service) Retire(ctx context.Context, id uuid.UUID, actor uuid.UUID) (Template, error) {
	return s.repo.Update(ctx, id, func(cur Template) (Template, *Version, []audit.Event, error) {
		if cur.Retired {
			return cur, nil, nil, nil
		}
		now := s.now()
		next := cur
		next.Retired, next.RetiredAt, next.UpdatedAt, next.UpdatedByUserID = true, &now, now, actor
		ev, err := s.event(actor, EventRetired, id, now, nil, map[string]any{"name": cur.Name})
		return next, nil, []audit.Event{ev}, err
	})
}

// ForGenerate is the template's published version, when it may generate:
// published and not retired (ErrNotPublished).
func (s *Service) ForGenerate(ctx context.Context, id uuid.UUID) (Template, Version, error) {
	t, err := s.repo.Get(ctx, id)
	if err != nil {
		return Template{}, Version{}, err
	}
	v, ok := t.Published()
	if !ok || t.Retired {
		return Template{}, Version{}, ErrNotPublished
	}
	return t, v, nil
}
