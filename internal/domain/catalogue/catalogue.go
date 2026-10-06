// Package catalogue is the Item Catalogue: the only normal source of item name,
// details, size group, prices and service period. Values are copied into
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

// Icon is an item's pictogram, from a fixed set the web app draws.
type Icon string

const (
	IconShoes           Icon = "shoes"
	IconJacket          Icon = "jacket"
	IconInsulatedJacket Icon = "insulated_jacket"
	IconTrousers        Icon = "trousers"
	IconVest            Icon = "vest"
	IconGloves          Icon = "gloves"
	IconHelmet          Icon = "helmet"
	IconWeldingHelmet   Icon = "welding_helmet"
	IconGlasses         Icon = "glasses"
	IconEar             Icon = "ear"
	IconMask            Icon = "mask"
	IconOther           Icon = "other"
)

// Icons lists every Icon, in the order a picker offers them. The database's
// catalogue_items_icon_check (migration 0014) must list the same values.
var Icons = []Icon{
	IconShoes, IconJacket, IconInsulatedJacket, IconTrousers, IconVest, IconGloves,
	IconHelmet, IconWeldingHelmet, IconGlasses, IconEar, IconMask, IconOther,
}

func (i Icon) Valid() bool {
	for _, x := range Icons {
		if i == x {
			return true
		}
	}
	return false
}

// Item is one orderable catalogue entry. It has two prices: the purchase
// price, what the supplier charges, and the accounting price, what the
// organisation books and orders show. AccountingPriceCents and
// ServicePeriodMonths may be nil while an item is being set up; Mark as Ordered
// refuses such an item (see Orderable). PurchasePriceCents is optional.
type Item struct {
	ID                   uuid.UUID  `json:"id"`
	Name                 string     `json:"name"`
	Details              string     `json:"details"`
	SizeGroup            size.Group `json:"size_group"`
	PurchasePriceCents   *int64     `json:"purchase_price_cents"`
	AccountingPriceCents *int64     `json:"accounting_price_cents"`
	Currency             string     `json:"currency"`
	ServicePeriodMonths  *int       `json:"service_period_months"`
	Active               bool       `json:"active"`
	DisplayRank          int        `json:"display_rank"`
	Icon                 Icon       `json:"icon"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
	DeletedAt            *time.Time `json:"deleted_at,omitempty"`
	CreatedByUserID      uuid.UUID  `json:"created_by_user_id"`
	UpdatedByUserID      uuid.UUID  `json:"updated_by_user_id"`
	DeletedByUserID      *uuid.UUID `json:"deleted_by_user_id,omitempty"`
}

// PriceEntry is one step of an item's price history, from its audit events:
// the prices and service period it was created with, then each change.
type PriceEntry struct {
	At     time.Time `json:"at"`
	Event  string    `json:"event"`   // EventCreated or EventPriceChanged
	ByName *string   `json:"by_name"` // the user's current name; nil if unknown
	// PurchasePriceCents, AccountingPriceCents and ServicePeriodMonths are the
	// values from At on. Events from before the purchase price existed have
	// none.
	PurchasePriceCents   *int64 `json:"purchase_price_cents"`
	AccountingPriceCents *int64 `json:"accounting_price_cents"`
	ServicePeriodMonths  *int   `json:"service_period_months"`
	// Before* are the values replaced; all nil for EventCreated.
	BeforePurchaseCents   *int64 `json:"before_purchase_cents"`
	BeforeAccountingCents *int64 `json:"before_accounting_cents"`
	BeforeServiceMonths   *int   `json:"before_service_months"`
}

func (i Item) Deleted() bool { return i.DeletedAt != nil }

// Orderable reports whether the item can go on a new order: live, active, and
// with both an accounting price and a service period. The purchase price is
// optional.
func (i Item) Orderable() bool {
	return !i.Deleted() && i.Active && i.AccountingPriceCents != nil && i.ServicePeriodMonths != nil
}

// Params are the client-settable fields; Update replaces all of them.
// Currency is not settable: it is always EUR.
type Params struct {
	Name                 string
	Details              string
	SizeGroup            size.Group
	PurchasePriceCents   *int64
	AccountingPriceCents *int64
	ServicePeriodMonths  *int
	Active               bool
	DisplayRank          *int
	// Icon is the pictogram; empty is IconOther.
	Icon Icon
}

func (p *Params) Normalize() {
	p.Name = strings.TrimSpace(p.Name)
	p.Details = strings.TrimSpace(p.Details)
	p.SizeGroup = size.Group(strings.ToUpper(strings.TrimSpace(string(p.SizeGroup))))
	if p.DisplayRank == nil {
		r := DefaultDisplayRank
		p.DisplayRank = &r
	}
	p.Icon = Icon(strings.ToLower(strings.TrimSpace(string(p.Icon))))
	if p.Icon == "" {
		p.Icon = IconOther
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
	case p.PurchasePriceCents != nil && *p.PurchasePriceCents < 0:
		return fieldError("purchase_price_cents", "must not be negative")
	case p.AccountingPriceCents != nil && *p.AccountingPriceCents < 0:
		return fieldError("accounting_price_cents", "must not be negative")
	case p.ServicePeriodMonths != nil && *p.ServicePeriodMonths < 1:
		return fieldError("service_period_months", "must be at least 1")
	case *p.DisplayRank < 0:
		return fieldError("display_rank", "must not be negative")
	case !p.Icon.Valid():
		return fieldError("icon", "is not a known pictogram")
	}
	return nil
}
