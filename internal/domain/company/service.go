package company

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// The companies' audit events (docs/specs/company-service.md, "Audit").
const (
	// EventCreated: a new company; its after is the company's details (not its
	// notes) and is_default when it became the default, as the first does.
	EventCreated = "company.created"
	// EventUpdated: the changed details, before and after; changed notes are
	// notes_changed, without their text.
	EventUpdated = "company.updated"
	// EventMadeDefault: the company became the default; its before names the
	// previous default (previous_default), if any.
	EventMadeDefault = "company.made_default"
	// EventDeleted: a soft delete; its before is the code and name.
	EventDeleted = "company.deleted"
	// Entity is the audit entity type of a company, keyed by its ID.
	Entity = "company"
)

// Service holds the companies' use cases.
type Service struct {
	repo  Repository
	now   func() time.Time
	newID func() uuid.UUID
}

// Option configures a Service.
type Option func(*Service)

// WithClock replaces the clock (UTC, microseconds, as Postgres stores them).
func WithClock(now func() time.Time) Option { return func(s *Service) { s.now = now } }

// NewService is the company service over repo.
func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{repo: repo, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New}
	for _, o := range opts {
		o(s)
	}
	return s
}

// details are a company's fields as its events record them, by key; notes are
// left out (free text: see EventUpdated).
func details(c Company) map[string]any {
	return map[string]any{
		"code": c.Code, "name": c.Name, "company_code": c.CompanyCode, "vat_code": c.VATCode,
		"address": c.Address, "city": c.City, "postal_code": c.PostalCode, "country": c.Country,
	}
}

// apply sets p's fields on c.
func apply(c Company, p Params) Company {
	c.Code, c.Name, c.CompanyCode, c.VATCode = p.Code, p.Name, p.CompanyCode, p.VATCode
	c.Address, c.City, c.PostalCode, c.Country, c.Notes = p.Address, p.City, p.PostalCode, p.Country, p.Notes
	return c
}

// event is an audit event on the company id by actor.
func (s *Service) event(actor uuid.UUID, name string, id uuid.UUID, at time.Time, before, after any) (audit.Event, error) {
	return audit.New(s.newID(), &actor, name, Entity, id, at, before, after)
}

// Create is Add Company, with company.created. The first company, added while
// there is no default, becomes the default.
func (s *Service) Create(ctx context.Context, p Params, actor uuid.UUID) (Company, error) {
	if actor == uuid.Nil {
		return Company{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return Company{}, err
	}
	first := false
	if _, err := s.repo.Default(ctx); errors.Is(err, ErrNotFound) {
		first = true
	} else if err != nil {
		return Company{}, err
	}
	c, err := s.create(ctx, p, first, actor)
	if errors.Is(err, ErrDefaultTaken) {
		// Another first company was added at the same moment and is the default.
		c, err = s.create(ctx, p, false, actor)
	}
	return c, err
}

// create stores a new company, the default when isDefault.
func (s *Service) create(ctx context.Context, p Params, isDefault bool, actor uuid.UUID) (Company, error) {
	now := s.now()
	c := apply(Company{ID: s.newID(), IsDefault: isDefault, CreatedAt: now, UpdatedAt: now, CreatedByUserID: actor, UpdatedByUserID: actor}, p)
	after := details(c)
	if isDefault {
		after["is_default"] = true
	}
	ev, err := s.event(actor, EventCreated, c.ID, now, nil, after)
	if err != nil {
		return Company{}, err
	}
	return s.repo.Create(ctx, c, ev)
}

// Get is the live company, or ErrNotFound.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Company, error) {
	return s.repo.Get(ctx, id)
}

// Default is the default company, or ErrNotFound when there is none (no
// company yet).
func (s *Service) Default(ctx context.Context) (Company, error) { return s.repo.Default(ctx) }

// List is every live company, the default first, then by name.
func (s *Service) List(ctx context.Context) ([]Company, error) { return s.repo.List(ctx) }

// Update replaces every field, recording company.updated with the changed
// ones; saving what it already has records nothing.
func (s *Service) Update(ctx context.Context, id uuid.UUID, p Params, actor uuid.UUID) (Company, error) {
	if actor == uuid.Nil {
		return Company{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return Company{}, err
	}
	return s.repo.Update(ctx, id, func(cur Company) (Company, []audit.Event, error) {
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

// MakeDefault makes the company the default, with company.made_default; the
// previous default stops being it. The default already records nothing.
func (s *Service) MakeDefault(ctx context.Context, id uuid.UUID, actor uuid.UUID) (Company, error) {
	if actor == uuid.Nil {
		return Company{}, fieldError("actor", "is required")
	}
	return s.repo.MakeDefault(ctx, id, func(cur Company, old *Company) (Company, []audit.Event, error) {
		if cur.IsDefault {
			return cur, nil, nil
		}
		now := s.now()
		next := cur
		next.IsDefault, next.UpdatedAt, next.UpdatedByUserID = true, now, actor
		var before any
		if old != nil {
			before = map[string]any{"previous_default": old.Name}
		}
		ev, err := s.event(actor, EventMadeDefault, cur.ID, now, before, map[string]any{"name": cur.Name})
		if err != nil {
			return next, nil, err
		}
		return next, []audit.Event{ev}, nil
	})
}

// Delete soft-deletes a company with company.deleted. The default company
// is refused (ErrIsDefault), and so is one that employs anyone now
// (ErrInUse); past employments keep naming it. Its code is free again.
func (s *Service) Delete(ctx context.Context, id uuid.UUID, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	_, err := s.repo.Update(ctx, id, func(cur Company) (Company, []audit.Event, error) {
		switch {
		case cur.IsDefault:
			return cur, nil, ErrIsDefault
		case cur.EmployeeCount > 0:
			return cur, nil, ErrInUse
		}
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
