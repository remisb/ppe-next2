package order

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

const (
	EventLinkCreated = "order.confirmation_link_created"
	EventGiven       = "order.given"
	// DefaultConfirmTTL is how long a confirmation link stays usable.
	DefaultConfirmTTL = 7 * 24 * time.Hour
)

// Record is an order with its receipt and, once GIVEN, the confirmation
// evidence. It backs View Record, Print Record and the public confirmation page.
type Record struct {
	Order        Order
	Receipt      Receipt
	DocumentHash string
	// Confirmation is the evidence of a GIVEN order; nil while ORDERED.
	Confirmation *Confirmation
}

// ConfirmSnapshot is what a confirmation sees inside its transaction, with the
// order row locked.
type ConfirmSnapshot struct {
	Order Order
	// Link is the locked electronic link being used, or nil for paper.
	Link *Confirmation
	// GiverName is the name of the user recorded as having given the items.
	GiverName string
}

// ConfirmResult tells the repository what to write. Noop means the order is
// already GIVEN and nothing is written.
type ConfirmResult struct {
	Noop         bool
	Order        Order
	Confirmation Confirmation // inserted if new (paper), else updated by ID
	IsNew        bool
	Event        audit.Event
}

type ConfirmFunc func(s ConfirmSnapshot) (ConfirmResult, error)

// LinkFunc builds a new link for a locked order; it may refuse (ErrNotOrdered).
type LinkFunc func(o Order) (Confirmation, audit.Event, error)

// CreateConfirmationLink is Open Employee Confirmation: a new single-use link
// for an ORDERED order. Earlier unused links are revoked. The plaintext token
// is returned once and never stored.
func (s *Service) CreateConfirmationLink(ctx context.Context, orderID, actor uuid.UUID) (string, time.Time, error) {
	if actor == uuid.Nil {
		return "", time.Time{}, fieldError("actor", "is required")
	}
	token, err := newToken()
	if err != nil {
		return "", time.Time{}, err
	}
	now := s.now()
	expires := now.Add(s.confirmTTL)
	hash := HashToken(token)
	err = s.repo.CreateLink(ctx, orderID, func(o Order) (Confirmation, audit.Event, error) {
		if o.Status != StatusOrdered {
			return Confirmation{}, audit.Event{}, ErrNotOrdered
		}
		c := Confirmation{
			ID: s.newID(), OrderID: o.ID, Method: MethodElectronic, TokenHash: &hash, ExpiresAt: &expires,
			CreatedAt: now, CreatedByUserID: actor,
		}
		ev, err := audit.New(s.newID(), &actor, EventLinkCreated, auditEntity, o.ID, now, nil,
			map[string]any{"confirmation_id": c.ID, "expires_at": expires})
		return c, ev, err
	})
	if err != nil {
		return "", time.Time{}, err
	}
	return token, expires, nil
}

// RecordByToken is the public confirmation page's view. An unknown, expired
// or revoked link for an ORDERED order is ErrLinkExpired; once the order is
// GIVEN its links show the final record.
func (s *Service) RecordByToken(ctx context.Context, token string) (Record, error) {
	link, err := s.repo.LinkByHash(ctx, HashToken(token))
	if err != nil {
		return Record{}, err
	}
	r, err := s.Record(ctx, link.OrderID)
	if err != nil {
		return Record{}, err
	}
	if r.Order.Status != StatusGiven && !link.Usable(s.now()) {
		return Record{}, ErrLinkExpired
	}
	return r, nil
}

// ConfirmByToken is algorithm C (electronic confirmation). It is idempotent: a
// repeated confirmation returns the existing GIVEN record and writes nothing.
func (s *Service) ConfirmByToken(ctx context.Context, token string, confirmed bool) (Record, error) {
	if !confirmed {
		return Record{}, fieldError("confirmed", "must be checked")
	}
	link, err := s.repo.LinkByHash(ctx, HashToken(token))
	if err != nil {
		return Record{}, err
	}
	o, err := s.repo.Confirm(ctx, link.OrderID, &link.ID, link.CreatedByUserID, func(snap ConfirmSnapshot) (ConfirmResult, error) {
		// Already GIVEN (through this link, another, or paper): return the
		// existing record and create nothing.
		if snap.Order.Status == StatusGiven {
			return ConfirmResult{Noop: true}, nil
		}
		now := s.now()
		if !snap.Link.Usable(now) {
			return ConfirmResult{}, ErrLinkExpired
		}
		return s.give(snap, *snap.Link, false, MethodElectronic, snap.Link.CreatedByUserID, nil, now)
	})
	if err != nil {
		return Record{}, err
	}
	return s.Record(ctx, o.ID)
}

// ConfirmPaper records a signed paper receipt for an ORDERED order. The actor
// is recorded as giver. Idempotent like electronic confirmation.
func (s *Service) ConfirmPaper(ctx context.Context, orderID, actor uuid.UUID) (Record, error) {
	if actor == uuid.Nil {
		return Record{}, fieldError("actor", "is required")
	}
	o, err := s.repo.Confirm(ctx, orderID, nil, actor, func(snap ConfirmSnapshot) (ConfirmResult, error) {
		if snap.Order.Status == StatusGiven {
			return ConfirmResult{Noop: true}, nil
		}
		now := s.now()
		c := Confirmation{ID: s.newID(), OrderID: orderID, Method: MethodPaper, CreatedAt: now, CreatedByUserID: actor}
		return s.give(snap, c, true, MethodPaper, actor, &actor, now)
	})
	if err != nil {
		return Record{}, err
	}
	return s.Record(ctx, o.ID)
}

// give turns a locked ORDERED order into GIVEN with confirmation evidence:
// the employee's name from the snapshot and the hash of the locked receipt.
func (s *Service) give(snap ConfirmSnapshot, c Confirmation, isNew bool, method Method, giver uuid.UUID, eventActor *uuid.UUID, now time.Time) (ConfirmResult, error) {
	o := snap.Order
	hash := DocumentHash(ReceiptOf(o))
	name := o.EmployeeFirstName + " " + o.EmployeeLastName
	c.ConfirmedAt, c.ConfirmedName, c.DocumentHash = &now, &name, &hash

	o.Status = StatusGiven
	o.GivenAt, o.GivenByUserID, o.GivenByName = &now, &giver, &snap.GiverName
	o.ConfirmationMethod = &method
	o.UpdatedAt, o.UpdatedByUserID = now, eventActor

	ev, err := audit.New(s.newID(), eventActor, EventGiven, auditEntity, o.ID, now,
		map[string]any{"status": StatusOrdered},
		map[string]any{"status": StatusGiven, "method": method, "document_hash": hash, "confirmed_name": name})
	return ConfirmResult{Order: o, Confirmation: c, IsNew: isNew, Event: ev}, err
}

// Record returns an order with its receipt. For a GIVEN order the stored
// document hash is returned, so a record can be checked against its evidence.
func (s *Service) Record(ctx context.Context, orderID uuid.UUID) (Record, error) {
	o, err := s.repo.Get(ctx, orderID)
	if err != nil {
		return Record{}, err
	}
	r := Record{Order: o, Receipt: ReceiptOf(o)}
	r.DocumentHash = DocumentHash(r.Receipt)
	if o.Status == StatusGiven {
		c, err := s.repo.ConfirmedFor(ctx, orderID)
		if err != nil {
			return Record{}, err
		}
		r.Confirmation = &c
		if c.DocumentHash != nil {
			r.DocumentHash = *c.DocumentHash
		}
	}
	return r, nil
}
