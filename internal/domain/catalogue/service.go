package catalogue

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

const (
	EventCreated      = "catalogue.created"
	EventUpdated      = "catalogue.updated"
	EventPriceChanged = "catalogue.price_changed"
	EventActivated    = "catalogue.activated"
	EventDeactivated  = "catalogue.deactivated"
	EventDeleted      = "catalogue.deleted"
	auditEntity       = "catalogue_item"
)

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

// priceSnapshot is what price events record. Events written before migration
// 0021 hold the accounting price as unit_price_cents and no purchase price;
// readers fall back to that key, since audit events are never rewritten.
type priceSnapshot struct {
	PurchasePriceCents   *int64 `json:"purchase_price_cents"`
	AccountingPriceCents *int64 `json:"accounting_price_cents"`
	Currency             string `json:"currency"`
	ServicePeriodMonths  *int   `json:"service_period_months"`
}

func priceOf(i Item) priceSnapshot {
	return priceSnapshot{PurchasePriceCents: i.PurchasePriceCents, AccountingPriceCents: i.AccountingPriceCents,
		Currency: i.Currency, ServicePeriodMonths: i.ServicePeriodMonths}
}

func (a priceSnapshot) equal(b priceSnapshot) bool {
	return eqPtr(a.PurchasePriceCents, b.PurchasePriceCents) && eqPtr(a.AccountingPriceCents, b.AccountingPriceCents) &&
		a.Currency == b.Currency && eqPtr(a.ServicePeriodMonths, b.ServicePeriodMonths)
}

func eqPtr[T comparable](a, b *T) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func (s *Service) event(actor uuid.UUID, name string, id uuid.UUID, at time.Time, before, after any) (*audit.Event, error) {
	ev, err := audit.New(s.newID(), &actor, name, auditEntity, id, at, before, after)
	if err != nil {
		return nil, err
	}
	return &ev, nil
}

func (s *Service) Create(ctx context.Context, p Params, actor uuid.UUID) (Item, error) {
	if actor == uuid.Nil {
		return Item{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return Item{}, err
	}
	now := s.now()
	i := Item{
		ID: s.newID(), Name: p.Name, Details: p.Details, SizeGroup: p.SizeGroup,
		PurchasePriceCents: p.PurchasePriceCents, AccountingPriceCents: p.AccountingPriceCents,
		Currency: CurrencyEUR, ServicePeriodMonths: p.ServicePeriodMonths,
		Active: p.Active, DisplayRank: *p.DisplayRank, Icon: p.Icon,
		CreatedAt: now, UpdatedAt: now, CreatedByUserID: actor, UpdatedByUserID: actor,
	}
	ev, err := s.event(actor, EventCreated, i.ID, now, nil, priceOf(i))
	if err != nil {
		return Item{}, err
	}
	if err := s.repo.Create(ctx, i, ev); err != nil {
		return Item{}, err
	}
	return i, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Item, error) { return s.repo.Get(ctx, id) }
func (s *Service) List(ctx context.Context) ([]Item, error)            { return s.repo.List(ctx) }

// ListActive feeds the Add Item selector: inactive items never appear there,
// though they stay visible in order snapshots.
func (s *Service) ListActive(ctx context.Context) ([]Item, error) { return s.repo.ListActive(ctx) }

// Update replaces every mutable field. A change to either price or the service
// period records catalogue.price_changed with the before and after values; an
// active-flag change records activated/deactivated; a change to the name,
// details, size group, pictogram or order records catalogue.updated.
func (s *Service) Update(ctx context.Context, id uuid.UUID, p Params, actor uuid.UUID) (Item, error) {
	if actor == uuid.Nil {
		return Item{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return Item{}, err
	}
	return s.repo.Update(ctx, id, func(cur Item) (Item, []audit.Event, error) {
		next := cur
		next.Name, next.Details, next.SizeGroup = p.Name, p.Details, p.SizeGroup
		next.PurchasePriceCents, next.AccountingPriceCents = p.PurchasePriceCents, p.AccountingPriceCents
		next.ServicePeriodMonths = p.ServicePeriodMonths
		next.Active, next.DisplayRank, next.Icon = p.Active, *p.DisplayRank, p.Icon
		return s.touch(cur, next, actor)
	})
}

// SetActive is Activate / Deactivate.
func (s *Service) SetActive(ctx context.Context, id uuid.UUID, active bool, actor uuid.UUID) (Item, error) {
	if actor == uuid.Nil {
		return Item{}, fieldError("actor", "is required")
	}
	return s.repo.Update(ctx, id, func(cur Item) (Item, []audit.Event, error) {
		next := cur
		next.Active = active
		return s.touch(cur, next, actor)
	})
}

// detailsChange is what catalogue.updated records: the changed descriptive
// fields, before and after.
func detailsChange(cur, next Item) (before, after map[string]any) {
	before, after = map[string]any{}, map[string]any{}
	set := func(key string, changed bool, b, a any) {
		if changed {
			before[key], after[key] = b, a
		}
	}
	set("name", cur.Name != next.Name, cur.Name, next.Name)
	set("details", cur.Details != next.Details, cur.Details, next.Details)
	set("size_group", cur.SizeGroup != next.SizeGroup, cur.SizeGroup, next.SizeGroup)
	set("icon", cur.Icon != next.Icon, cur.Icon, next.Icon)
	set("display_rank", cur.DisplayRank != next.DisplayRank, cur.DisplayRank, next.DisplayRank)
	return before, after
}

// touch stamps next and builds an event for each kind of change: the prices
// (the item's price history), activation, and the descriptive fields.
func (s *Service) touch(cur, next Item, actor uuid.UUID) (Item, []audit.Event, error) {
	now := s.now()
	next.UpdatedAt, next.UpdatedByUserID = now, actor
	var evs []audit.Event
	add := func(name string, before, after any) error {
		ev, err := s.event(actor, name, cur.ID, now, before, after)
		if err == nil {
			evs = append(evs, *ev)
		}
		return err
	}
	if !priceOf(cur).equal(priceOf(next)) {
		if err := add(EventPriceChanged, priceOf(cur), priceOf(next)); err != nil {
			return next, nil, err
		}
	}
	if cur.Active != next.Active {
		name := EventDeactivated
		if next.Active {
			name = EventActivated
		}
		if err := add(name, nil, nil); err != nil {
			return next, nil, err
		}
	}
	if before, after := detailsChange(cur, next); len(after) > 0 {
		if err := add(EventUpdated, before, after); err != nil {
			return next, nil, err
		}
	}
	return next, evs, nil
}

// Delete soft-deletes an item. Order snapshots keep its values.
func (s *Service) Delete(ctx context.Context, id uuid.UUID, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	_, err := s.repo.Update(ctx, id, func(cur Item) (Item, []audit.Event, error) {
		now := s.now()
		next := cur
		next.DeletedAt, next.DeletedByUserID = &now, &actor
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		ev, err := s.event(actor, EventDeleted, cur.ID, now, nil, nil)
		if err != nil {
			return next, nil, err
		}
		return next, []audit.Event{*ev}, nil
	})
	return err
}

// PriceHistory is the live item's prices and service period over time, newest
// first: each change, then the values it was created with.
func (s *Service) PriceHistory(ctx context.Context, id uuid.UUID) ([]PriceEntry, error) {
	if _, err := s.repo.Get(ctx, id); err != nil {
		return nil, err
	}
	return s.repo.PriceHistory(ctx, id)
}
