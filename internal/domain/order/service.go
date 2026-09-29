package order

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

const (
	EventOrdered = "order.ordered"
	EventDeleted = "order.deleted"
	auditEntity  = "order"
)

// Service holds the order use cases.
type Service struct {
	repo  Repository
	read  Readers
	now   func() time.Time
	newID func() uuid.UUID
	// loc is the organisation's timezone: History date filters and usage time
	// count calendar days there. Timestamps are stored in UTC.
	loc *time.Location
	// confirmTTL is how long a confirmation link is usable.
	confirmTTL time.Duration
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }
func WithLocation(loc *time.Location) Option      { return func(s *Service) { s.loc = loc } }
func WithConfirmTTL(d time.Duration) Option       { return func(s *Service) { s.confirmTTL = d } }

func NewService(repo Repository, r Readers, opts ...Option) *Service {
	s := &Service{repo: repo, read: r, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New, loc: time.UTC, confirmTTL: DefaultConfirmTTL}
	for _, o := range opts {
		o(s)
	}
	return s
}

// orderedSummary is what the order.ordered event records.
type orderedSummary struct {
	RecordNumber string    `json:"record_number"`
	EmployeeID   uuid.UUID `json:"employee_id"`
	Status       Status    `json:"status"`
	Lines        int       `json:"lines"`
	TotalCents   int64     `json:"total_cents"`
}

// MarkAsOrdered implements algorithm B: the boundary between editable working
// data and an immutable record. Every displayed value is copied from the
// catalogue and employee rows read inside the transaction; the client supplies
// only items, quantities and sizes.
func (s *Service) MarkAsOrdered(ctx context.Context, p MarkAsOrderedParams, actor uuid.UUID) (Order, error) {
	if actor == uuid.Nil {
		return Order{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return Order{}, err
	}
	ids := make([]uuid.UUID, len(p.Lines))
	for i, l := range p.Lines {
		ids[i] = l.CatalogueItemID
	}
	return s.repo.Create(ctx, p.EmployeeID, ids, actor, func(snap Snapshot) (Order, audit.Event, error) {
		now := s.now()
		o := Order{
			ID:                s.newID(),
			RecordSeq:         snap.RecordSeq,
			EmployeeID:        snap.Employee.ID,
			EmployeeFirstName: snap.Employee.FirstName,
			EmployeeLastName:  snap.Employee.LastName,
			EmployeeCode:      snap.Employee.Code,
			Status:            StatusOrdered,
			OrderedAt:         now,
			PreparedByUserID:  actor,
			PreparedByName:    snap.PreparedByName,
			UpdatedAt:         now,
			// The wording is fixed with the order, as its lines are.
			ReceiptTextVersion: ReceiptTextVersion,
			Lines:              make([]Line, 0, len(p.Lines)),
		}
		for i, l := range p.Lines {
			item, ok := snap.Items[l.CatalogueItemID]
			switch {
			case !ok || !item.Active:
				name := item.Name
				if name == "" {
					name = l.CatalogueItemID.String()
				}
				return Order{}, audit.Event{}, fmt.Errorf("%w: %s", ErrItemUnavailable, name)
			case item.UnitPriceCents == nil || item.ServicePeriodMonths == nil:
				return Order{}, audit.Event{}, fmt.Errorf("%w: %s", ErrPriceMissing, item.Name)
			}
			if err := CheckSize(i, item.SizeGroup, l.Size); err != nil {
				return Order{}, audit.Event{}, err
			}
			o.Lines = append(o.Lines, Line{
				ID:                  s.newID(),
				LineNo:              i + 1,
				CatalogueItemID:     item.ID,
				ItemName:            item.Name,
				ItemDetails:         item.Details,
				SizeGroup:           item.SizeGroup,
				Size:                l.Size,
				Quantity:            l.Quantity,
				UnitPriceCents:      *item.UnitPriceCents,
				Currency:            item.Currency,
				ServicePeriodMonths: *item.ServicePeriodMonths,
			})
		}
		ev, err := audit.New(s.newID(), &actor, EventOrdered, auditEntity, o.ID, now, nil, orderedSummary{
			RecordNumber: o.RecordNumber(), EmployeeID: o.EmployeeID, Status: o.Status,
			Lines: len(o.Lines), TotalCents: o.TotalCents(),
		})
		return o, ev, err
	})
}

// Delete soft-deletes an order, ORDERED or GIVEN, for clearing demo and test
// orders. The route allows only the manager role. The order leaves History,
// the dashboards and Replacements due; its unused confirmation links stop
// working; its row, lines, evidence and audit trail stay. The event records
// what was deleted.
func (s *Service) Delete(ctx context.Context, id uuid.UUID, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	return s.repo.Delete(ctx, id, func(cur Order) (Order, audit.Event, error) {
		now := s.now()
		next := cur
		next.DeletedAt, next.DeletedByUserID = &now, &actor
		next.UpdatedAt, next.UpdatedByUserID = now, &actor
		ev, err := audit.New(s.newID(), &actor, EventDeleted, auditEntity, cur.ID, now, orderedSummary{
			RecordNumber: cur.RecordNumber(), EmployeeID: cur.EmployeeID, Status: cur.Status,
			Lines: len(cur.Lines), TotalCents: cur.TotalCents(),
		}, nil)
		return next, ev, err
	})
}

// Get returns a stored order with its snapshot lines.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Order, error) {
	return s.repo.Get(ctx, id)
}
