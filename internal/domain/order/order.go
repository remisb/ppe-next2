// Package order is the Order aggregate: the order, its immutable snapshot lines
// and its confirmations. An order exists only from Mark as Ordered onwards;
// the only later change is ORDERED → GIVEN through a confirmation.
package order

import (
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/size"
)

// Status is one of the only two stored statuses. There is deliberately no
// draft, partial or outstanding state: an unsubmitted order is client state.
type Status string

const (
	StatusOrdered Status = "ORDERED"
	StatusGiven   Status = "GIVEN"
)

// Method is how receipt was confirmed.
type Method string

const (
	MethodElectronic Method = "ELECTRONIC"
	MethodPaper      Method = "PAPER"
)

// Order is an immutable business record. Employee and user names are
// snapshotted so a record never depends on the live employees or users rows.
type Order struct {
	ID                 uuid.UUID  `json:"id"`
	RecordSeq          int64      `json:"-"`
	EmployeeID         uuid.UUID  `json:"employee_id"`
	EmployeeFirstName  string     `json:"employee_first_name"`
	EmployeeLastName   string     `json:"employee_last_name"`
	EmployeeCode       *string    `json:"employee_code"`
	Status             Status     `json:"status"`
	OrderedAt          time.Time  `json:"ordered_at"`
	PreparedByUserID   uuid.UUID  `json:"prepared_by_user_id"`
	PreparedByName     string     `json:"prepared_by_name"`
	GivenAt            *time.Time `json:"given_at"`
	GivenByUserID      *uuid.UUID `json:"given_by_user_id"`
	GivenByName        *string    `json:"given_by_name"`
	ConfirmationMethod *Method    `json:"confirmation_method"`
	UpdatedAt          time.Time  `json:"updated_at"`
	UpdatedByUserID    *uuid.UUID `json:"updated_by_user_id"`
	Lines              []Line     `json:"lines"`
}

// RecordNumber is the human-facing record number, e.g. WE-000123.
func (o Order) RecordNumber() string { return FormatRecordNumber(o.RecordSeq) }

// FormatRecordNumber renders a sequence value as a record number.
func FormatRecordNumber(seq int64) string { return fmt.Sprintf("WE-%06d", seq) }

// ActivityAt is when the order last changed status: newest-first sort key.
func (o Order) ActivityAt() time.Time {
	if o.GivenAt != nil {
		return *o.GivenAt
	}
	return o.OrderedAt
}

// TotalCents is the sum of line totals.
func (o Order) TotalCents() int64 {
	var t int64
	for _, l := range o.Lines {
		t += l.TotalCents()
	}
	return t
}

// Line is an immutable snapshot of one item as displayed at Mark as Ordered.
type Line struct {
	ID                  uuid.UUID  `json:"id"`
	LineNo              int        `json:"line_no"`
	CatalogueItemID     uuid.UUID  `json:"catalogue_item_id"`
	ItemName            string     `json:"item_name"`
	ItemDetails         string     `json:"item_details"`
	SizeGroup           size.Group `json:"size_group"`
	Size                *string    `json:"size"`
	Quantity            int        `json:"quantity"`
	UnitPriceCents      int64      `json:"unit_price_cents"`
	Currency            string     `json:"currency"`
	ServicePeriodMonths int        `json:"service_period_months"`
}

func (l Line) TotalCents() int64 { return l.UnitPriceCents * int64(l.Quantity) }

// Confirmation is a confirmation link or a paper confirmation, with its
// evidence once confirmed. Only the token's hash is ever stored.
type Confirmation struct {
	ID              uuid.UUID
	OrderID         uuid.UUID
	Method          Method
	TokenHash       *string
	ExpiresAt       *time.Time
	RevokedAt       *time.Time
	ConfirmedAt     *time.Time
	ConfirmedName   *string
	DocumentHash    *string
	CreatedAt       time.Time
	CreatedByUserID uuid.UUID
}

// Usable reports whether an electronic link can still be used at now.
func (c Confirmation) Usable(now time.Time) bool {
	return c.Method == MethodElectronic && c.RevokedAt == nil && c.ConfirmedAt == nil &&
		c.ExpiresAt != nil && now.Before(*c.ExpiresAt)
}

// LineParams is one working line sent with Mark as Ordered. Only the item,
// quantity and size come from the client; every other value is re-read from
// the catalogue inside the transaction.
type LineParams struct {
	CatalogueItemID uuid.UUID
	Quantity        int
	Size            *string
}

// MarkAsOrderedParams is the whole working order.
type MarkAsOrderedParams struct {
	EmployeeID uuid.UUID
	Lines      []LineParams
}

const maxLines = 200

// Validate checks what can be checked without the catalogue. Size against the
// item's size group is checked by the service once the item is loaded.
func (p *MarkAsOrderedParams) Validate() error {
	switch {
	case p.EmployeeID == uuid.Nil:
		return fieldError("employee_id", "is required")
	case len(p.Lines) == 0:
		return fieldError("lines", "must contain at least one item")
	case len(p.Lines) > maxLines:
		return fieldError("lines", "has too many items")
	}
	seen := make(map[uuid.UUID]bool, len(p.Lines))
	for i, l := range p.Lines {
		field := "lines[" + strconv.Itoa(i) + "]"
		switch {
		case l.CatalogueItemID == uuid.Nil:
			return fieldError(field+".catalogue_item_id", "is required")
		case seen[l.CatalogueItemID]:
			// One line per catalogue item: repeated Add Item raises the quantity.
			return fieldError(field+".catalogue_item_id", "appears more than once")
		case l.Quantity < 1:
			return fieldError(field+".quantity", "must be an integer of at least 1")
		}
		seen[l.CatalogueItemID] = true
	}
	return nil
}

// CheckSize reports whether size suits an item of group g, as a field error.
func CheckSize(i int, g size.Group, s *string) error {
	if size.Fits(g, s) {
		return nil
	}
	field := "lines[" + strconv.Itoa(i) + "].size"
	switch {
	case g == size.GroupNone:
		return fieldError(field, "must be empty for a no-size item")
	case s == nil:
		return fieldError(field, "is required")
	default:
		return fieldError(field, "is not valid for "+string(g))
	}
}

// DaysPerMonth is the average month length used for usage time.
const DaysPerMonth = 30.44

// UsageMonths implements algorithm D: months since the order was given, to one
// decimal. It is nil for orders that are not GIVEN. now and the given time are
// compared in loc, the organisation's timezone, so day boundaries match what
// users see.
func UsageMonths(o Order, now time.Time, loc *time.Location) *float64 {
	if o.Status != StatusGiven || o.GivenAt == nil {
		return nil
	}
	elapsed := now.In(loc).Sub(o.GivenAt.In(loc)).Hours() / 24
	if elapsed < 0 {
		elapsed = 0
	}
	m := math.Round(elapsed/DaysPerMonth*10) / 10
	return &m
}
