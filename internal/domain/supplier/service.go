package supplier

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// The suppliers' audit events (docs/specs/supplier-service.md, "Audit").
const (
	// EventCreated: a new supplier; its after is the supplier's details
	// (not its notes).
	EventCreated = "supplier.created"
	// EventUpdated: the changed details, before and after; changed notes are
	// notes_changed, without their text.
	EventUpdated = "supplier.updated"
	// EventDeleted: a soft delete; its before is the code and name.
	EventDeleted = "supplier.deleted"
	// Entity is the audit entity type of a supplier, keyed by its ID.
	Entity = "supplier"
)

// Service holds the suppliers' use cases.
type Service struct {
	repo  Repository
	now   func() time.Time
	newID func() uuid.UUID
}

// Option configures a Service.
type Option func(*Service)

// WithClock replaces the clock (UTC, microseconds, as Postgres stores them).
func WithClock(now func() time.Time) Option { return func(s *Service) { s.now = now } }

// NewService is the supplier service over repo.
func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{repo: repo, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New}
	for _, o := range opts {
		o(s)
	}
	return s
}

// details are a supplier's fields as its events record them, by key; notes are
// left out (free text: see EventUpdated).
func details(s Supplier) map[string]any {
	return map[string]any{
		"code": s.Code, "name": s.Name, "company_code": s.CompanyCode, "vat_code": s.VATCode,
		"address": s.Address, "city": s.City, "postal_code": s.PostalCode, "country": s.Country,
		"contact_person": s.ContactPerson, "email": s.Email, "phone": s.Phone, "website": s.Website,
		"bank_account": s.BankAccount,
	}
}

// apply sets p's fields on s.
func apply(s Supplier, p Params) Supplier {
	s.Code, s.Name, s.CompanyCode, s.VATCode = p.Code, p.Name, p.CompanyCode, p.VATCode
	s.Address, s.City, s.PostalCode, s.Country = p.Address, p.City, p.PostalCode, p.Country
	s.ContactPerson, s.Email, s.Phone, s.Website = p.ContactPerson, p.Email, p.Phone, p.Website
	s.BankAccount, s.Notes = p.BankAccount, p.Notes
	return s
}

// event is an audit event on the supplier id by actor.
func (s *Service) event(actor uuid.UUID, name string, id uuid.UUID, at time.Time, before, after any) (audit.Event, error) {
	return audit.New(s.newID(), &actor, name, Entity, id, at, before, after)
}

// Create is Add Supplier, with supplier.created.
func (s *Service) Create(ctx context.Context, p Params, actor uuid.UUID) (Supplier, error) {
	if actor == uuid.Nil {
		return Supplier{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return Supplier{}, err
	}
	now := s.now()
	sup := apply(Supplier{ID: s.newID(), CreatedAt: now, UpdatedAt: now, CreatedByUserID: actor, UpdatedByUserID: actor}, p)
	ev, err := s.event(actor, EventCreated, sup.ID, now, nil, details(sup))
	if err != nil {
		return Supplier{}, err
	}
	return s.repo.Create(ctx, sup, ev)
}

// Get is the live supplier, or ErrNotFound.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Supplier, error) {
	return s.repo.Get(ctx, id)
}

// List is every live supplier by name, then code.
func (s *Service) List(ctx context.Context) ([]Supplier, error) { return s.repo.List(ctx) }

// Update replaces every field, recording supplier.updated with the changed
// ones; saving what it already has records nothing.
func (s *Service) Update(ctx context.Context, id uuid.UUID, p Params, actor uuid.UUID) (Supplier, error) {
	if actor == uuid.Nil {
		return Supplier{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return Supplier{}, err
	}
	return s.repo.Update(ctx, id, func(cur Supplier) (Supplier, []audit.Event, error) {
		next := apply(cur, p)
		before, after := map[string]any{}, map[string]any{}
		was, is := details(cur), details(next)
		for k, v := range is {
			if was[k] != v {
				before[k], after[k] = was[k], v
			}
		}
		if cur.Notes != next.Notes {
			after["notes_changed"] = true
		}
		if len(after) == 0 {
			return cur, nil, nil
		}
		now := s.now()
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		ev, err := s.event(actor, EventUpdated, cur.ID, now, before, after)
		if err != nil {
			return next, nil, err
		}
		return next, []audit.Event{ev}, nil
	})
}

// Delete soft-deletes a supplier with supplier.deleted. Its items keep
// their link, which reads as no supplier from then on; its code is free again.
func (s *Service) Delete(ctx context.Context, id uuid.UUID, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	_, err := s.repo.Update(ctx, id, func(cur Supplier) (Supplier, []audit.Event, error) {
		now := s.now()
		next := cur
		next.DeletedAt, next.DeletedByUserID = &now, &actor
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		ev, err := s.event(actor, EventDeleted, cur.ID, now, map[string]any{"code": cur.Code, "name": cur.Name}, nil)
		if err != nil {
			return next, nil, err
		}
		return next, []audit.Event{ev}, nil
	})
	return err
}
