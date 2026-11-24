package template

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

type memRepo struct {
	mu     sync.Mutex
	rows   map[uuid.UUID]Template
	events []string
}

func (m *memRepo) Create(_ context.Context, t Template, v Version, ev audit.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	t.Versions = []Version{v}
	m.rows[t.ID] = t
	m.events = append(m.events, ev.Event)
	return nil
}

func (m *memRepo) Get(_ context.Context, id uuid.UUID) (Template, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.rows[id]
	if !ok {
		return Template{}, ErrNotFound
	}
	t.Versions = slices.Clone(t.Versions)
	return t, nil
}

func (m *memRepo) List(context.Context) ([]Template, error) { return nil, nil }

func (m *memRepo) Update(ctx context.Context, id uuid.UUID, mut Mutation) (Template, error) {
	cur, err := m.Get(ctx, id)
	if err != nil {
		return Template{}, err
	}
	next, v, evs, err := mut(cur)
	if err != nil || len(evs) == 0 {
		return cur, err
	}
	if v != nil {
		i := slices.IndexFunc(next.Versions, func(x Version) bool { return x.Number == v.Number })
		if i >= 0 {
			next.Versions[i] = *v
		} else {
			next.Versions = append([]Version{*v}, next.Versions...)
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rows[id] = next
	for _, e := range evs {
		m.events = append(m.events, e.Event)
	}
	return next, nil
}

func body(runs ...Run) Body {
	return Body{Format: Format, Blocks: []Block{{Type: Paragraph, Text: runs}}}
}

func TestTemplateLifecycle(t *testing.T) {
	repo := &memRepo{rows: map[uuid.UUID]Template{}}
	svc := NewService(repo)
	ctx := context.Background()
	actor := uuid.New()
	if _, err := svc.Create(ctx, Details{Type: "employee.certificate", Name: "x", Language: "lt"}, actor); !errors.Is(err, ErrInvalid) {
		t.Errorf("a type not generated: %v", err)
	}
	tpl, err := svc.Create(ctx, Details{Type: "employment.contract", Name: "  Darbo   sutartis ", Language: "lt"}, actor)
	if err != nil {
		t.Fatal(err)
	}
	if d, ok := tpl.Draft(); !ok || tpl.Name != "Darbo sutartis" || d.Number != 1 {
		t.Fatalf("created = %+v", tpl)
	}
	// A draft is checked: known fields, closed braces, asked fields.
	for name, c := range map[string]struct {
		b     Body
		asked []Asked
	}{
		"unknown field":  {body(Run{Field: "employee.salary"}), nil},
		"both":           {body(Run{Field: "today", Text: "x"}), nil},
		"no blocks":      {Body{Format: Format}, nil},
		"bad asked key":  {body(Run{Text: "x"}), []Asked{{Key: "Salary", Label: "x", Kind: AskText}}},
		"choice options": {body(Run{Text: "x"}), []Asked{{Key: "shift", Label: "x", Kind: AskChoice, Options: []string{"day"}}}},
		"unknown kind":   {body(Run{Text: "x"}), []Asked{{Key: "x", Label: "x", Kind: "html"}}},
	} {
		if _, err := svc.SaveDraft(ctx, tpl.ID, c.b, c.asked, actor); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
	asked := []Asked{{Key: "salary", Label: "Alga", Kind: AskMoney, Required: true}}
	if _, err := svc.SaveDraft(ctx, tpl.ID, body(Run{Field: "input.salary"}), asked, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Publish(ctx, tpl.ID, actor); !errors.Is(err, ErrInvalid) {
		t.Errorf("published without {{document.number}}: %v", err)
	}
	if _, err := svc.SaveDraft(ctx, tpl.ID, body(Run{Text: "Nr. "}, Run{Field: "document.number"}, Run{Field: "input.salary"}), asked, actor); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.ForGenerate(ctx, tpl.ID); !errors.Is(err, ErrNotPublished) {
		t.Errorf("before publishing: %v", err)
	}
	pub, err := svc.Publish(ctx, tpl.ID, actor)
	if err != nil || pub.Current == nil || *pub.Current != 1 {
		t.Fatalf("publish = %+v %v", pub.Current, err)
	}
	if _, ok := pub.Draft(); ok {
		t.Error("a draft is left after publishing")
	}
	// Editing again starts version 2; version 1 stays what generates.
	next, err := svc.SaveDraft(ctx, tpl.ID, body(Run{Text: "v2 "}, Run{Field: "document.number"}), nil, actor)
	if d, _ := next.Draft(); err != nil || d.Number != 2 || *next.Current != 1 {
		t.Fatalf("v2 draft = %+v %v", next, err)
	}
	if _, v, err := svc.ForGenerate(ctx, tpl.ID); err != nil || v.Number != 1 {
		t.Errorf("generates with %v %v", v.Number, err)
	}
	if _, err := svc.Retire(ctx, tpl.ID, actor); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.ForGenerate(ctx, tpl.ID); !errors.Is(err, ErrNotPublished) {
		t.Errorf("retired: %v", err)
	}
	want := []string{EventCreated, EventDraftSaved, EventDraftSaved, EventPublished, EventDraftSaved, EventRetired}
	if !slices.Equal(repo.events, want) {
		t.Errorf("events = %v", repo.events)
	}
}

func TestWritten(t *testing.T) {
	for _, c := range []struct{ day, lang, want string }{
		{"2026-11-24", "lt", "2026 m. lapkričio 24 d."},
		{"2026-11-24", "ru", "24 ноября 2026 г."},
		{"2026-11-24", "en", "24 November 2026"},
		{"24.11.2026", "lt", "24.11.2026"},
	} {
		if got := LongDate(c.day, c.lang); got != c.want {
			t.Errorf("LongDate(%s, %s) = %q", c.day, c.lang, got)
		}
	}
	if got := Money(240050, "lt"); got != "2 400,50 EUR" {
		t.Errorf("lt money = %q", got)
	}
	if got := Money(123456789, "en"); got != "EUR 1,234,567.89" {
		t.Errorf("en money = %q", got)
	}
	for in, want := range map[string]int64{"2400": 240000, "2 400,5": 240050, "2400.55 €": 240055} {
		if got, ok := ParseMoney(in); !ok || got != want {
			t.Errorf("ParseMoney(%q) = %d %v", in, got, ok)
		}
	}
	if _, ok := ParseMoney("lots"); ok {
		t.Error("lots is an amount")
	}
}

func TestInputs(t *testing.T) {
	asked := []Asked{
		{Key: "start", Label: "Start", Kind: AskDate, Required: true},
		{Key: "shift", Label: "Shift", Kind: AskChoice, Options: []string{"Day", "Night"}},
		{Key: "note", Label: "Note", Kind: AskText},
	}
	got, err := Inputs(asked, map[string]string{"start": "2026-12-01", "shift": "Night"}, "en")
	if err != nil || got["input.start"] != "1 December 2026" || got["input.shift"] != "Night" || got["input.note"] != "" {
		t.Fatalf("inputs = %v %v", got, err)
	}
	for name, answers := range map[string]map[string]string{
		"missing":   {"shift": "Day"},
		"not a day": {"start": "1.12.2026"},
		"no option": {"start": "2026-12-01", "shift": "Evening"},
		"two lines": {"start": "2026-12-01", "note": "a\nb"},
		"unknown":   {"start": "2026-12-01", "bonus": "1"},
	} {
		if _, err := Inputs(asked, answers, "en"); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestDecodeBodyIsStrict(t *testing.T) {
	if _, err := DecodeBody([]byte(`{"format":"ppe.blocks.v1","blocks":[{"type":"paragraph","html":"<b>x</b>"}]}`)); !errors.Is(err, ErrInvalid) {
		t.Errorf("an unknown key: %v", err)
	}
	b, err := DecodeBody([]byte(`{"format":"ppe.blocks.v1","blocks":[{"type":"paragraph","text":[{"text":"x","bold":true}]}]}`))
	if err != nil || !b.Blocks[0].Text[0].Bold {
		t.Errorf("decoded = %+v %v", b, err)
	}
}
