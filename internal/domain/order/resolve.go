package order

import (
	"context"
	"strconv"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/size"
)

// The order package reads live employee, catalogue and item-set data only
// through these consumer-declared views; cmd/api/checkers.go adapts the other
// domains to them, so no domain package imports another.

// EmployeeView is the part of an employee resolution needs.
type EmployeeView struct {
	ID        uuid.UUID
	FirstName string
	LastName  string
	Code      *string
	Sizes     size.Defaults
}

// ItemView is the part of a catalogue item resolution needs.
type ItemView struct {
	ID                  uuid.UUID
	Name                string
	Details             string
	SizeGroup           size.Group
	UnitPriceCents      *int64
	Currency            string
	ServicePeriodMonths *int
	Active              bool
}

// SetLineView is one line of an item set, in display order.
type SetLineView struct {
	CatalogueItemID uuid.UUID
	DefaultQuantity int
}

type EmployeeReader interface {
	// Employee returns a live employee or ErrEmployeeNotFound.
	Employee(ctx context.Context, id uuid.UUID) (EmployeeView, error)
}

type CatalogueReader interface {
	// Items returns the live items among ids; deleted or unknown ids are absent.
	Items(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]ItemView, error)
}

type ItemSetReader interface {
	// ActiveSetLines returns an active, live set's lines in display order, or
	// ErrItemSetNotFound.
	ActiveSetLines(ctx context.Context, id uuid.UUID) ([]SetLineView, error)
}

// Readers groups the live-data views the order service needs.
type Readers struct {
	Employees EmployeeReader
	Catalogue CatalogueReader
	ItemSets  ItemSetReader
}

// ResolveLine is one requested working line: an item and a quantity. Sizes
// are never sent: resolution reports what the employee's defaults give, and
// the client decides whether to keep a size the user picked by hand.
type ResolveLine struct {
	CatalogueItemID uuid.UUID
	Quantity        int
}

// WorkingLine is a resolved, editable line (manual algorithm A). It is a
// preview of current data, not a snapshot.
type WorkingLine struct {
	CatalogueItemID     uuid.UUID  `json:"catalogue_item_id"`
	ItemName            string     `json:"item_name"`
	ItemDetails         string     `json:"item_details"`
	SizeGroup           size.Group `json:"size_group"`
	Size                *string    `json:"size"`
	SizeSuggested       bool       `json:"size_suggested"`
	SizeMissing         bool       `json:"size_missing"`
	Quantity            int        `json:"quantity"`
	UnitPriceCents      *int64     `json:"unit_price_cents"`
	Currency            string     `json:"currency"`
	ServicePeriodMonths *int       `json:"service_period_months"`
	// PriceMissing: the item has no price or service period yet; Mark as
	// Ordered will refuse it until the catalogue is completed.
	PriceMissing bool `json:"price_missing"`
	// Unavailable: the item is inactive or deleted and cannot be ordered.
	Unavailable bool `json:"unavailable"`
}

// Resolution is a resolved working order.
type Resolution struct {
	Employee EmployeeView  `json:"-"`
	Lines    []WorkingLine `json:"lines"`
}

// Orderable reports whether every line could be ordered as resolved (sizes
// present, prices set, items available). Manually entered sizes can make a
// line with SizeMissing orderable; the client tracks that.
func (r Resolution) Orderable() bool {
	if len(r.Lines) == 0 {
		return false
	}
	for _, l := range r.Lines {
		if l.SizeMissing || l.PriceMissing || l.Unavailable {
			return false
		}
	}
	return true
}

// Resolve implements algorithm A for every requested line. Repeated items are
// merged into one line with the summed quantity (one line per catalogue item),
// keeping the position of the first occurrence.
func (s *Service) Resolve(ctx context.Context, employeeID uuid.UUID, lines []ResolveLine) (Resolution, error) {
	if employeeID == uuid.Nil {
		return Resolution{}, fieldError("employee_id", "is required")
	}
	if len(lines) > maxLines {
		return Resolution{}, fieldError("lines", "has too many items")
	}
	merged := make([]ResolveLine, 0, len(lines))
	pos := make(map[uuid.UUID]int, len(lines))
	for i, l := range lines {
		field := "lines[" + strconv.Itoa(i) + "]"
		switch {
		case l.CatalogueItemID == uuid.Nil:
			return Resolution{}, fieldError(field+".catalogue_item_id", "is required")
		case l.Quantity < 1:
			return Resolution{}, fieldError(field+".quantity", "must be an integer of at least 1")
		}
		if j, ok := pos[l.CatalogueItemID]; ok {
			merged[j].Quantity += l.Quantity
			continue
		}
		pos[l.CatalogueItemID] = len(merged)
		merged = append(merged, l)
	}

	emp, err := s.read.Employees.Employee(ctx, employeeID)
	if err != nil {
		return Resolution{}, err
	}
	ids := make([]uuid.UUID, len(merged))
	for i, l := range merged {
		ids[i] = l.CatalogueItemID
	}
	items, err := s.read.Catalogue.Items(ctx, ids)
	if err != nil {
		return Resolution{}, err
	}

	out := Resolution{Employee: emp, Lines: make([]WorkingLine, 0, len(merged))}
	for _, l := range merged {
		out.Lines = append(out.Lines, resolveLine(emp, items[l.CatalogueItemID], l))
	}
	return out, nil
}

func resolveLine(emp EmployeeView, item ItemView, l ResolveLine) WorkingLine {
	w := WorkingLine{CatalogueItemID: l.CatalogueItemID, Quantity: l.Quantity}
	if item.ID == uuid.Nil { // deleted or unknown
		w.Unavailable = true
		return w
	}
	w.ItemName, w.ItemDetails, w.SizeGroup = item.Name, item.Details, item.SizeGroup
	w.UnitPriceCents, w.Currency, w.ServicePeriodMonths = item.UnitPriceCents, item.Currency, item.ServicePeriodMonths
	w.Unavailable = !item.Active
	w.PriceMissing = item.UnitPriceCents == nil || item.ServicePeriodMonths == nil
	r := size.Resolve(item.SizeGroup, emp.Sizes)
	w.Size, w.SizeSuggested, w.SizeMissing = r.Size, r.Suggested, r.Missing
	return w
}

// ApplyItemSet resolves every line of an active item set for the employee, in
// the set's display order with its default quantities. Sizes, prices and
// service periods come fresh from the employee and the catalogue.
func (s *Service) ApplyItemSet(ctx context.Context, setID, employeeID uuid.UUID) (Resolution, error) {
	setLines, err := s.read.ItemSets.ActiveSetLines(ctx, setID)
	if err != nil {
		return Resolution{}, err
	}
	lines := make([]ResolveLine, len(setLines))
	for i, l := range setLines {
		lines[i] = ResolveLine{CatalogueItemID: l.CatalogueItemID, Quantity: l.DefaultQuantity}
	}
	return s.Resolve(ctx, employeeID, lines)
}
