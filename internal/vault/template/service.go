package template

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/vault"
	"github.com/remisb/ppe-next2/internal/vault/docx"
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
	Number int    `json:"number"`
	State  string `json:"state"`
	// Kind is blocks (written in the editor) or docx (an uploaded Word document, phase 8).
	Kind        string     `json:"kind"`
	Body        Body       `json:"body"`
	Asked       []Asked    `json:"asked"`
	BodySHA256  string     `json:"body_sha256"`
	Docx        *DocxFile  `json:"docx,omitempty"`
	UpdatedAt   time.Time  `json:"updated_at"`
	PublishedAt *time.Time `json:"published_at"`
}

// Version kinds (vault.template_versions.kind).
const (
	KindBlocks = "blocks"
	KindDocx   = "docx"
)

// DocxFile is a DOCX version's file in the files store; its SHA-256 is the body's.
type DocxFile struct {
	Key  string `json:"-"`
	Name string `json:"name"`
	Size int64  `json:"size"`
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
	store files.Store
	now   func() time.Time
	newID func() uuid.UUID
}

// WithFiles sets where DOCX templates are kept; without it uploading one is ErrNoStorage.
func WithFiles(store files.Store) Option { return func(s *Service) { s.store = store } }

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
	v := Version{Number: 1, State: Draft, Kind: KindBlocks, Body: body, Asked: []Asked{}, BodySHA256: sum, UpdatedAt: now}
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
		// A DOCX body is the uploaded file's: saving one again changes only the
		// asked fields, and needs the draft to hold that very file.
		kind, file := KindBlocks, (*DocxFile)(nil)
		if body.IsDocx() {
			if !ok || draft.Docx == nil || draft.Body.DocxSHA256 != body.DocxSHA256 || !slices.Equal(draft.Body.DocxFields, body.DocxFields) {
				return cur, nil, nil, fieldError("body", "is a DOCX the draft does not hold: upload it again")
			}
			kind, file = KindDocx, draft.Docx
		}
		if !ok {
			draft = Version{Number: 1, State: Draft}
			if len(cur.Versions) > 0 {
				draft.Number = cur.Versions[0].Number + 1
			}
		}
		now := s.now()
		draft.Kind, draft.Docx = kind, file
		draft.Body, draft.Asked, draft.BodySHA256, draft.UpdatedAt = body, asked, sum, now
		next := cur
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		ev, err := s.event(actor, EventDraftSaved, id, now, nil, map[string]any{"version": draft.Number, "kind": kind, "body_sha256": sum})
		return next, &draft, []audit.Event{ev}, err
	})
}

// UploadDocx saves a Word document as the template's draft (phase 8), with
// the asked fields: a DOCX of at most 5 MB whose placeholders, joined where
// Word split them across runs, each name a field the app fills or an asked
// one. The file is kept first (vault-templates/<template>/<sha>.docx: one
// key per content, so a published version's never changes), then the draft.
func (s *Service) UploadDocx(ctx context.Context, id uuid.UUID, name string, data []byte, asked []Asked, actor uuid.UUID) (Template, error) {
	if s.store == nil {
		return Template{}, ErrNoStorage
	}
	if asked == nil {
		asked = []Asked{}
	}
	if err := CheckAsked(asked); err != nil {
		return Template{}, err
	}
	fields, err := docx.Fields(data, func(k string) bool { return Known(k, asked) })
	switch {
	case errors.Is(err, docx.ErrTooLarge):
		return Template{}, ErrTooLarge
	case errors.Is(err, docx.ErrNotDocx):
		return Template{}, ErrFileType
	case errors.Is(err, docx.ErrSplitPlaceholder):
		return Template{}, fieldError("docx", "has a {{ whose }} is not in the same paragraph")
	case err != nil:
		if key, ok := docx.FieldError(err); ok {
			return Template{}, fieldError("docx", "uses an unknown field {{"+key+"}}")
		}
		return Template{}, fieldError("docx", "cannot be read")
	}
	sum := sha256.Sum256(data)
	body := Body{Format: FormatDocx, Blocks: []Block{}, DocxSHA256: hex.EncodeToString(sum[:]), DocxFields: fields}
	if _, err := s.repo.Get(ctx, id); err != nil {
		return Template{}, err
	}
	file := &DocxFile{Key: "vault-templates/" + id.String() + "/" + body.DocxSHA256 + ".docx", Name: files.Name(name, files.DOCX, "template"), Size: int64(len(data))}
	if err := s.store.Put(ctx, file.Key, bytes.NewReader(data), file.Size, files.DOCX); err != nil {
		return Template{}, fmt.Errorf("template: storing the DOCX: %w", err)
	}
	hash, err := Hash(body, asked)
	if err != nil {
		return Template{}, err
	}
	return s.repo.Update(ctx, id, func(cur Template) (Template, *Version, []audit.Event, error) {
		draft, ok := cur.Draft()
		if ok && draft.BodySHA256 == hash && draft.Docx != nil && draft.Docx.Name == file.Name {
			return cur, nil, nil, nil
		}
		if !ok {
			draft = Version{Number: 1, State: Draft}
			if len(cur.Versions) > 0 {
				draft.Number = cur.Versions[0].Number + 1
			}
		}
		now := s.now()
		draft.Kind, draft.Docx, draft.Body, draft.Asked, draft.BodySHA256, draft.UpdatedAt = KindDocx, file, body, asked, hash, now
		next := cur
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		ev, err := s.event(actor, EventDraftSaved, id, now, nil, map[string]any{
			"version": draft.Number, "kind": KindDocx, "body_sha256": hash, "docx_sha256": body.DocxSHA256, "file_name": file.Name,
		})
		return next, &draft, []audit.Event{ev}, err
	})
}

// DocxBytes are a DOCX version's file, checked against its hash.
func (s *Service) DocxBytes(ctx context.Context, v Version) ([]byte, error) {
	if v.Docx == nil {
		return nil, ErrNotFound
	}
	if s.store == nil {
		return nil, ErrNoStorage
	}
	r, err := s.store.Get(ctx, v.Docx.Key)
	if err != nil {
		return nil, fmt.Errorf("template: the DOCX of version %d: %w", v.Number, err)
	}
	defer r.Close()
	data, err := io.ReadAll(io.LimitReader(r, docx.MaxBytes+1))
	if err != nil {
		return nil, err
	}
	if sum := sha256.Sum256(data); hex.EncodeToString(sum[:]) != v.Body.DocxSHA256 {
		return nil, fmt.Errorf("template: the DOCX of version %d does not match its hash", v.Number)
	}
	return data, nil
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
		// A DOCX prints its own footer: it must print the hash, as a block
		// template's footer does.
		if draft.Body.IsDocx() && !slices.Contains(draft.Body.FieldKeys(), "document.hash") {
			return cur, nil, nil, fieldError("body", "must print {{document.hash}}")
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
