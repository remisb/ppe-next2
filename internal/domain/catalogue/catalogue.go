// Package catalogue is the Item Catalogue: the only normal source of item name,
// details, size group, unit price and service period. Values are copied into
// order lines at Mark as Ordered, so editing an item never changes history.
package catalogue

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/size"
)

// CurrencyEUR is the only supported currency.
const CurrencyEUR = "EUR"

const (
	maxNameLen    = 200
	maxDetailsLen = 1000
	// DefaultDisplayRank sorts after the manual's fixed-order items.
	DefaultDisplayRank = 1000
)

// Item is one orderable catalogue entry. UnitPriceCents and
// ServicePeriodMonths may be nil while an item is being set up; Mark as Ordered
// refuses such an item (see Orderable).
type Item struct {
	ID                  uuid.UUID  `json:"id"`
	Name                string     `json:"name"`
	Details             string     `json:"details"`
	SizeGroup           size.Group `json:"size_group"`
	UnitPriceCents      *int64     `json:"unit_price_cents"`
	Currency            string     `json:"currency"`
	ServicePeriodMonths *int       `json:"service_period_months"`
	Active              bool       `json:"active"`
	DisplayRank         int        `json:"display_rank"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	DeletedAt           *time.Time `json:"deleted_at,omitempty"`
	CreatedByUserID     uuid.UUID  `json:"created_by_user_id"`
	UpdatedByUserID     uuid.UUID  `json:"updated_by_user_id"`
	DeletedByUserID     *uuid.UUID `json:"deleted_by_user_id,omitempty"`
}

func (i Item) Deleted() bool { return i.DeletedAt != nil }

// Orderable reports whether the item can go on a new order: live, active, and
// with both a price and a service period.
func (i Item) Orderable() bool {
	return !i.Deleted() && i.Active && i.UnitPriceCents != nil && i.ServicePeriodMonths != nil
}

// Params are the client-settable fields; Update replaces all of them.
// Currency is not settable: it is always EUR.
type Params struct {
	Name                string
	Details             string
	SizeGroup           size.Group
	UnitPriceCents      *int64
	ServicePeriodMonths *int
	Active              bool
	DisplayRank         *int
}

func (p *Params) Normalize() {
	p.Name = strings.TrimSpace(p.Name)
	p.Details = strings.TrimSpace(p.Details)
	p.SizeGroup = size.Group(strings.ToUpper(strings.TrimSpace(string(p.SizeGroup))))
	if p.DisplayRank == nil {
		r := DefaultDisplayRank
		p.DisplayRank = &r
	}
}

func (p *Params) Validate() error {
	p.Normalize()
	switch {
	case p.Name == "":
		return fieldError("name", "is required")
	case len(p.Name) > maxNameLen:
		return fieldError("name", "is too long")
	case len(p.Details) > maxDetailsLen:
		return fieldError("details", "is too long")
	case !p.SizeGroup.Valid():
		return fieldError("size_group", "must be CLOTHING, SHOES or NONE")
	case p.UnitPriceCents != nil && *p.UnitPriceCents < 0:
		return fieldError("unit_price_cents", "must not be negative")
	case p.ServicePeriodMonths != nil && *p.ServicePeriodMonths < 1:
		return fieldError("service_period_months", "must be at least 1")
	case *p.DisplayRank < 0:
		return fieldError("display_rank", "must not be negative")
	}
	return nil
}
