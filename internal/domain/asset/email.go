package asset

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// EmailKind names one of a SIM card's emails to its provider: asking it to
// activate the card, or to block it.
type EmailKind string

const (
	EmailActivation EmailKind = "activation"
	EmailBlocking   EmailKind = "blocking"
)

func (k EmailKind) valid() bool { return k == EmailActivation || k == EmailBlocking }

// EmailCard is what a SIM card's email is made from: the card's numbers, plan
// and provider as recorded (empty when it has none), its holder's name (empty
// when no one holds it), the user preparing it and today in the organisation's zone.
type EmailCard struct {
	SIMNumber       string
	PhoneNumber     string
	InventoryNumber string
	Plan            string
	Provider        string
	EmployeeName    string
	Today           string
	Actor           uuid.UUID
}

// Email is a prepared email, for the user to copy into their own: nothing is
// sent. Missing lists the template's fields that had no value.
type Email struct {
	To      string   `json:"to"`
	CC      string   `json:"cc"`
	Subject string   `json:"subject"`
	Body    string   `json:"body"`
	Missing []string `json:"missing"`
}

// Mailer prepares a SIM card's emails from their templates, filling in what
// this package does not hold (the provider's e-mail, the company, the user's
// name and e-mail). The composition root adapts the mail templates and settings to it.
type Mailer interface {
	SIMEmail(ctx context.Context, kind EmailKind, card EmailCard) (Email, error)
}

// WithMailer sets what Prepare Activation Email and Prepare Blocking Email use.
func WithMailer(m Mailer) Option { return func(s *Service) { s.mailer = m } }

var errNoMailer = errors.New("asset: no mailer")

// PrepareEmail prepares a SIM card's activation or blocking email from its
// template (§14). Nothing is sent and nothing is recorded: RecordEmail
// records the copy.
func (s *Service) PrepareEmail(ctx context.Context, id uuid.UUID, kind EmailKind, actor uuid.UUID) (Email, error) {
	if actor == uuid.Nil {
		return Email{}, fieldError("actor", "is required")
	}
	if !kind.valid() {
		return Email{}, fieldError("kind", "must be activation or blocking")
	}
	if s.mailer == nil {
		return Email{}, errNoMailer
	}
	r, err := s.repo.Get(ctx, id)
	if err != nil {
		return Email{}, err
	}
	if r.Asset.Kind != KindSIM {
		return Email{}, fieldError("kind", "must be SIM: only a SIM card is activated or blocked by its provider")
	}
	a := r.Asset
	card := EmailCard{
		SIMNumber: deref(a.SimNo), PhoneNumber: deref(a.PhoneNo), InventoryNumber: a.InventoryNo, Plan: deref(a.Plan),
		Provider: deref(a.Provider), Today: s.today(), Actor: actor,
	}
	if r.Open != nil {
		card.EmployeeName = r.Open.EmployeeName
	}
	return s.mailer.SIMEmail(ctx, kind, card)
}

// RecordEmail records asset.activation_email_prepared or
// asset.blocking_email_prepared: the email asking the provider to activate
// or block a SIM card was copied (§14). Nothing is sent and the status does
// not change.
func (s *Service) RecordEmail(ctx context.Context, id uuid.UUID, kind EmailKind, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	event := EventBlockingEmailPrepared
	switch kind {
	case EmailActivation:
		event = EventActivationEmailPrepared
	case EmailBlocking:
	default:
		return fieldError("kind", "must be activation or blocking")
	}
	r, err := s.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	if r.Asset.Kind != KindSIM {
		return fieldError("kind", "must be SIM: only a SIM card is activated or blocked by its provider")
	}
	after := map[string]any{"sim_no": r.Asset.SimNo, "phone_no": r.Asset.PhoneNo, "provider": r.Asset.Provider}
	if r.Open != nil {
		after["assignment_id"], after["employee_id"], after["employee_name"] = r.Open.ID, r.Open.EmployeeID, r.Open.EmployeeName
	}
	ev, err := s.event(actor, event, id, s.now(), nil, after)
	if err != nil {
		return err
	}
	return s.repo.Record(ctx, ev)
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
