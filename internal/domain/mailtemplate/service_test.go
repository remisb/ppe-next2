package mailtemplate

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// fakeRepo holds the saved templates in memory, with the events written beside them.
type fakeRepo struct {
	saved  map[string]Template
	events []audit.Event
}

func (f *fakeRepo) List(context.Context) ([]Template, error) {
	out := make([]Template, 0, len(f.saved))
	for _, t := range f.saved {
		out = append(out, t)
	}
	return out, nil
}

func (f *fakeRepo) Get(_ context.Context, key string) (Template, error) {
	if t, ok := f.saved[key]; ok {
		return t, nil
	}
	return Template{Key: key}, nil
}

func (f *fakeRepo) Update(ctx context.Context, key string, m Mutation) (Template, error) {
	cur, _ := f.Get(ctx, key)
	next, ev, err := m(cur)
	if err != nil {
		return Template{}, err
	}
	if ev != nil {
		f.saved[key] = next
		f.events = append(f.events, *ev)
	}
	return next, nil
}

var at = time.Date(2026, 10, 28, 9, 0, 0, 0, time.UTC)

func newTestService() (*Service, *fakeRepo) {
	repo := &fakeRepo{saved: map[string]Template{}}
	return NewService(repo, WithClock(func() time.Time { return at })), repo
}

func TestUseCases(t *testing.T) {
	keys := []string{}
	for _, u := range UseCases() {
		keys = append(keys, u.Key)
		// Every default is a template that could be saved.
		p := TextParams(u.Default)
		if err := p.Validate(u); err != nil {
			t.Errorf("%s: default is invalid: %v", u.Key, err)
		}
		if p.text() != u.Default {
			t.Errorf("%s: default changes when normalised: %+v", u.Key, p)
		}
		for _, f := range u.Fields {
			if f.Label == "" || f.Sample == "" {
				t.Errorf("%s: field %s has no label or sample", u.Key, f.Key)
			}
		}
	}
	if !slices.Equal(keys, []string{KeySIMActivation, KeySIMBlocking}) {
		t.Fatalf("use cases = %v", keys)
	}
}

func TestValidate(t *testing.T) {
	u, _ := Find(KeySIMBlocking)
	ok := TextParams{To: "{{provider.email}}", Subject: "Block {{ sim.phone_number }}", Body: "Hello"}
	if err := ok.Validate(u); err != nil {
		t.Fatalf("valid without Cc: %v", err)
	}
	ok.CC = "{{user.email}}, office@gavort.lt"
	if err := ok.Validate(u); err != nil {
		t.Fatalf("valid with Cc: %v", err)
	}
	for name, c := range map[string]struct {
		p    TextParams
		want string
	}{
		"no recipient":       {TextParams{Subject: "S", Body: "B"}, "to is required"},
		"no subject":         {TextParams{To: "a@b.lt", Subject: "  ", Body: "B"}, "subject is required"},
		"no body":            {TextParams{To: "a@b.lt", Subject: "S", Body: "\n \n"}, "body is required"},
		"two-line subject":   {TextParams{To: "a@b.lt", Subject: "S\nT", Body: "B"}, "subject must be one line"},
		"unknown field":      {TextParams{To: "a@b.lt", Subject: "S", Body: "Hi {{sim.colour}}"}, "body uses an unknown field {{sim.colour}}"},
		"empty field":        {TextParams{To: "a@b.lt", Subject: "S {{ }}", Body: "B"}, "subject uses an unknown field {{}}"},
		"unclosed":           {TextParams{To: "{{provider.email", Subject: "S", Body: "B"}, "to has a {{ without its }}"},
		"opened twice":       {TextParams{To: "a@b.lt", Subject: "S", Body: "{{sim.number {{sim.plan}}"}, "body has a {{ without its }}"},
		"a body too long":    {TextParams{To: "a@b.lt", Subject: "S", Body: strings.Repeat("a", maxBodyLen+1)}, "body is longer"},
		"a subject too long": {TextParams{To: "a@b.lt", Subject: strings.Repeat("a", maxSubjectLen+1), Body: "B"}, "subject is longer"},
		"two-line Cc":        {TextParams{To: "a@b.lt", CC: "c@d.lt\ne@f.lt", Subject: "S", Body: "B"}, "cc must be one line"},
		"unknown Cc field":   {TextParams{To: "a@b.lt", CC: "{{boss.email}}", Subject: "S", Body: "B"}, "cc uses an unknown field {{boss.email}}"},
	} {
		t.Run(name, func(t *testing.T) {
			err := c.p.Validate(u)
			if !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("err = %v, want %q", err, c.want)
			}
		})
	}
}

func TestNormalize(t *testing.T) {
	p := TextParams{To: "  a@b.lt ", CC: " c@d.lt ", Subject: " S ", Body: "Hello,  \r\n\r\nBye\t\n\n"}
	p.Normalize()
	if p.To != "a@b.lt" || p.CC != "c@d.lt" || p.Subject != "S" || p.Body != "Hello,\n\nBye" {
		t.Fatalf("normalised = %+v", p)
	}
}

func TestRender(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	m, err := svc.Render(ctx, KeySIMBlocking, map[string]string{
		FieldPhoneNumber: "+370 612 40118", FieldSIMNumber: "8937", FieldProviderEmail: "sim@telia.lt",
		FieldCompanyName: "UAB Gavort", FieldUserName: " Ona ", "other.key": "ignored",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := "Hello,\n\nPlease block the following SIM:\n\nPhone number: +370 612 40118\nSIM number: 8937\nCompany: UAB Gavort\n\n" +
		"Please confirm once the SIM has been blocked.\n\nThank you.\nOna"
	if m.To != "sim@telia.lt" || m.CC != "" || m.Subject != "SIM blocking request - +370 612 40118" || m.Body != want || len(m.Missing) != 0 {
		t.Fatalf("message = %+v", m)
	}
	// A value missing reads as its label in brackets, and is listed once, in order.
	m, err = svc.Render(ctx, KeySIMBlocking, map[string]string{FieldSIMNumber: "8937", FieldUserName: "Ona", FieldCompanyName: "  "})
	if err != nil {
		t.Fatal(err)
	}
	if m.To != "[Provider E-mail]" || m.Subject != "SIM blocking request - [Phone Number]" || !strings.Contains(m.Body, "Company: [Company Name]") ||
		!slices.Equal(m.Missing, []string{FieldProviderEmail, FieldPhoneNumber, FieldCompanyName}) {
		t.Fatalf("missing = %+v", m)
	}
	// A value never breaks the subject onto two lines.
	m, _ = svc.Render(ctx, KeySIMBlocking, map[string]string{FieldPhoneNumber: "+370\n612"})
	if m.Subject != "SIM blocking request - +370 612" {
		t.Fatalf("subject = %q", m.Subject)
	}
	if _, err := svc.Render(ctx, "sim.unknown", nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown use case: err = %v", err)
	}
}

func TestUpdate(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	actor := uuid.New()
	u, _ := Find(KeySIMActivation)

	// Never saved: the default.
	tpl, err := svc.Get(ctx, KeySIMActivation)
	if err != nil || tpl.Text != u.Default || tpl.UpdatedAt != nil {
		t.Fatalf("Get = %+v, %v", tpl, err)
	}
	// Saving the default as it is records nothing.
	if _, err := svc.Update(ctx, KeySIMActivation, TextParams(u.Default), actor); err != nil || len(repo.events) != 0 {
		t.Fatalf("default again: %v, %d events", err, len(repo.events))
	}
	p := TextParams{To: " orders@telia.lt ", CC: "{{user.email}}", Subject: "Activate {{sim.number}}", Body: "Please activate {{sim.number}}.\n"}
	tpl, err = svc.Update(ctx, KeySIMActivation, p, actor)
	if err != nil || tpl.To != "orders@telia.lt" || tpl.Body != "Please activate {{sim.number}}." || tpl.UpdatedAt == nil || !tpl.UpdatedAt.Equal(at) ||
		*tpl.UpdatedByUserID != actor {
		t.Fatalf("Update = %+v, %v", tpl, err)
	}
	if len(repo.events) != 1 {
		t.Fatalf("events = %+v", repo.events)
	}
	ev := repo.events[0]
	if ev.Event != EventChanged || ev.EntityType != "mail_template" || ev.EntityID != EntityID(KeySIMActivation) ||
		!strings.Contains(string(ev.Before), `"subject":"SIM activation request - {{sim.number}}"`) ||
		string(ev.After) != `{"recipient":"orders@telia.lt","cc":"{{user.email}}","subject":"Activate {{sim.number}}","body":"Please activate {{sim.number}}."}` {
		t.Fatalf("event = %+v, %s, %s", ev, ev.Before, ev.After)
	}
	// The same again records nothing; the other template is still its default.
	if _, err := svc.Update(ctx, KeySIMActivation, p, actor); err != nil || len(repo.events) != 1 {
		t.Fatalf("unchanged: %v, %d events", err, len(repo.events))
	}
	list, err := svc.List(ctx)
	if err != nil || len(list) != 2 || list[0].Key != KeySIMActivation || list[0].To != "orders@telia.lt" || list[1].UpdatedAt != nil {
		t.Fatalf("List = %+v, %v", list, err)
	}
	// Rendering uses the saved text.
	if m, _ := svc.Render(ctx, KeySIMActivation, map[string]string{FieldSIMNumber: "8937", FieldUserEmail: "ona@gavort.lt"}); m.Subject != "Activate 8937" || m.To != "orders@telia.lt" ||
		m.CC != "ona@gavort.lt" {
		t.Fatalf("render = %+v", m)
	}
	// Reset: saving the default is a change.
	if tpl, err := svc.Update(ctx, KeySIMActivation, TextParams(u.Default), actor); err != nil || tpl.Text != u.Default || len(repo.events) != 2 {
		t.Fatalf("reset: %+v, %v, %d events", tpl, err, len(repo.events))
	}
}

func TestUpdateRejects(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	if _, err := svc.Update(ctx, "sim.unknown", TextParams{To: "a", Subject: "b", Body: "c"}, uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown use case: err = %v", err)
	}
	if _, err := svc.Update(ctx, KeySIMBlocking, TextParams{To: "a", Subject: "b", Body: "c"}, uuid.Nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("no actor: err = %v", err)
	}
	if _, err := svc.Update(ctx, KeySIMBlocking, TextParams{To: "a", Subject: "b", Body: "{{nope}}"}, uuid.New()); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown field: err = %v", err)
	}
	if len(repo.events) != 0 {
		t.Fatalf("a refused save recorded events: %+v", repo.events)
	}
}

func TestPreview(t *testing.T) {
	svc, _ := newTestService()
	m, err := svc.Preview(KeySIMBlocking, TextParams{To: "{{provider.email}}", Subject: "Block {{sim.phone_number}}", Body: "{{company.name}}"})
	if err != nil || m.To != "verslas@telia.lt" || m.Subject != "Block +370 612 40118" || m.Body != "UAB Pavyzdys" || len(m.Missing) != 0 {
		t.Fatalf("Preview = %+v, %v", m, err)
	}
	if _, err := svc.Preview(KeySIMBlocking, TextParams{To: "x", Subject: "y", Body: "{{sim.colour}}"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown field: err = %v", err)
	}
	if _, err := svc.Preview("nope", TextParams{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown use case: err = %v", err)
	}
}
