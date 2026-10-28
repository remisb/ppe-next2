package mailtemplate

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

const (
	EventChanged = "mail_template.changed"
	auditEntity  = "mail_template"
)

// EntityID names a template in audit events: templates are keyed by their
// use case, so it is a fixed id made from the key.
func EntityID(key string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("https://workwear.gavort.nl/mail-templates/"+key))
}

type Service struct {
	repo  Repository
	now   func() time.Time
	newID func() uuid.UUID
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{repo: repo, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New}
	for _, o := range opts {
		o(s)
	}
	return s
}

// withDefault is t, or its use case's default text when it was never saved.
func withDefault(u UseCase, t Template) Template {
	t.Key = u.Key
	if t.UpdatedAt == nil {
		t.Text = u.Default
	}
	return t
}

// List returns every use case's template, in the use cases' order.
func (s *Service) List(ctx context.Context) ([]Template, error) {
	saved, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	byKey := make(map[string]Template, len(saved))
	for _, t := range saved {
		byKey[t.Key] = t
	}
	out := make([]Template, 0, len(useCases))
	for _, u := range useCases {
		out = append(out, withDefault(u, byKey[u.Key]))
	}
	return out, nil
}

// Get returns the template of the use case with that key.
func (s *Service) Get(ctx context.Context, key string) (Template, error) {
	u, ok := Find(key)
	if !ok {
		return Template{}, ErrNotFound
	}
	t, err := s.repo.Get(ctx, key)
	if err != nil {
		return Template{}, err
	}
	return withDefault(u, t), nil
}

// Update replaces a template's text, recording mail_template.changed when it
// differs. Resetting a template is saving its use case's default.
func (s *Service) Update(ctx context.Context, key string, p TextParams, actor uuid.UUID) (Template, error) {
	u, ok := Find(key)
	if !ok {
		return Template{}, ErrNotFound
	}
	if actor == uuid.Nil {
		return Template{}, fieldError("actor", "is required")
	}
	if err := p.Validate(u); err != nil {
		return Template{}, err
	}
	return s.repo.Update(ctx, key, func(cur Template) (Template, *audit.Event, error) {
		cur = withDefault(u, cur)
		next := p.text()
		if next == cur.Text {
			return cur, nil, nil
		}
		now := s.now()
		ev, err := audit.New(s.newID(), &actor, EventChanged, auditEntity, EntityID(key), now, snapshot(cur.Text), snapshot(next))
		if err != nil {
			return Template{}, nil, err
		}
		return Template{Key: key, Text: next, UpdatedAt: &now, UpdatedByUserID: &actor}, &ev, nil
	})
}

// snapshot is a template's text as its audit events hold it.
func snapshot(t Text) any {
	return struct {
		Recipient string `json:"recipient"`
		CC        string `json:"cc"`
		Subject   string `json:"subject"`
		Body      string `json:"body"`
	}{t.To, t.CC, t.Subject, t.Body}
}

// Preview renders unsaved text for the use case with that key with its
// fields' samples, refusing text that could not be saved.
func (s *Service) Preview(key string, p TextParams) (Message, error) {
	u, ok := Find(key)
	if !ok {
		return Message{}, ErrNotFound
	}
	if err := p.Validate(u); err != nil {
		return Message{}, err
	}
	return render(u, p.text(), Samples(u)), nil
}

// Render prepares the email of the use case with that key from its template
// and values, keyed by field; values for other keys are ignored.
func (s *Service) Render(ctx context.Context, key string, values map[string]string) (Message, error) {
	t, err := s.Get(ctx, key)
	if err != nil {
		return Message{}, err
	}
	u, _ := Find(key)
	return render(u, t.Text, values), nil
}
