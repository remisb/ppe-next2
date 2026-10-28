package asset

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// fakeMailer keeps the card it was asked for and answers with its numbers.
type fakeMailer struct {
	kind EmailKind
	card EmailCard
}

func (m *fakeMailer) SIMEmail(_ context.Context, kind EmailKind, card EmailCard) (Email, error) {
	m.kind, m.card = kind, card
	return Email{To: "sim@telia.lt", Subject: string(kind) + " " + card.SIMNumber, Missing: []string{}}, nil
}

func TestPrepareEmail(t *testing.T) {
	f := newFixture(t)
	mailer := &fakeMailer{}
	WithMailer(mailer)(f.svc)
	v := f.sim(t, "SIM-000001", StatusActive, true)

	// The card's numbers, plan and provider; no holder yet; today in the organisation's zone.
	m, err := f.svc.PrepareEmail(f.ctx, v.ID, EmailBlocking, testActor)
	if err != nil || m.Subject != "blocking "+*v.SimNo || mailer.kind != EmailBlocking {
		t.Fatalf("PrepareEmail = %+v, %v", m, err)
	}
	want := EmailCard{SIMNumber: *v.SimNo, PhoneNumber: "+370 612 40118", InventoryNumber: "SIM-000001", Plan: "Biz 10 GB", Provider: "Telia",
		Today: testNow.In(vilnius).Format("2006-01-02"), Actor: testActor}
	if mailer.card != want {
		t.Fatalf("card = %+v, want %+v", mailer.card, want)
	}
	// Given: the holder's name.
	if _, err := f.give(t, v.ID, f.emp, "2026-10-01"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.PrepareEmail(f.ctx, v.ID, EmailActivation, testActor); err != nil || mailer.card.EmployeeName != "Jonas Petraitis" || mailer.kind != EmailActivation {
		t.Fatalf("given: %+v, %v", mailer.card, err)
	}
	// Preparing records nothing; copying does (RecordEmail).
	before := len(f.repo.events)
	if _, err := f.svc.PrepareEmail(f.ctx, v.ID, EmailBlocking, testActor); err != nil || len(f.repo.events) != before {
		t.Fatalf("preparing recorded %d events, %v", len(f.repo.events)-before, err)
	}

	pc, _ := f.svc.Create(f.ctx, CreateParams{Kind: KindEquipment, Params: Params{InventoryNo: "PC-000001", Name: sp("Laptop"), Category: ptr(CategoryComputer)}}, testActor)
	for name, c := range map[string]struct {
		id    uuid.UUID
		kind  EmailKind
		actor uuid.UUID
		want  error
	}{
		"no actor":     {v.ID, EmailBlocking, uuid.Nil, ErrInvalid},
		"another kind": {v.ID, "welcome", testActor, ErrInvalid},
		"no asset":     {uuid.New(), EmailBlocking, testActor, ErrNotFound},
		"equipment":    {pc.ID, EmailActivation, testActor, ErrInvalid},
	} {
		if _, err := f.svc.PrepareEmail(f.ctx, c.id, c.kind, c.actor); !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v, want %v", name, err, c.want)
		}
	}
	if err := f.svc.RecordEmail(f.ctx, pc.ID, EmailBlocking, testActor); !errors.Is(err, ErrInvalid) {
		t.Errorf("recording equipment's email: %v", err)
	}
}

func TestPrepareEmailWithoutMailer(t *testing.T) {
	f := newFixture(t)
	v := f.sim(t, "SIM-000001", StatusNotActivated, false)
	if _, err := f.svc.PrepareEmail(f.ctx, v.ID, EmailActivation, testActor); !errors.Is(err, errNoMailer) {
		t.Fatalf("err = %v, want errNoMailer", err)
	}
}
