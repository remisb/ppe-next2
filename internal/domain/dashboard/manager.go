package dashboard

import (
	"time"

	"github.com/google/uuid"
)

// ForecastDays is how far ahead the manager's replacement forecast looks.
const ForecastDays = 90

// ManagerWindow is what the repository reads for the manager's dashboard.
type ManagerWindow struct {
	Now time.Time
	// MonthStarts is as in Window: Months+1 local month starts in UTC.
	MonthStarts []time.Time
	// ForecastBy is Now plus ForecastDays.
	ForecastBy time.Time
	// PriceChangesSince bounds the price-change list (the Months period).
	PriceChangesSince time.Time
	Limit             int
}

// ManagerOverview is the manager's dashboard: items, prices and what will
// need buying. It reads order snapshots for what was ordered and given, and
// the live catalogue for current prices, which the manager maintains.
type ManagerOverview struct {
	GeneratedAt  time.Time      `json:"generated_at"`
	Timezone     string         `json:"timezone"`
	OnOrder      OnOrder        `json:"on_order"`
	Months       []OrderedMonth `json:"months"`
	SpendByItem  []TopItem      `json:"spend_by_item"`
	Forecast     Forecast       `json:"forecast"`
	PriceChanges []PriceChange  `json:"price_changes"`
	Catalogue    CatalogueCheck `json:"catalogue"`
	ItemSets     []ItemSetIssue `json:"item_sets"`
	Sizes        SizeSpread     `json:"sizes"`
}

// OnOrder is everything on ORDERED orders: ordered, not yet given out.
type OnOrder struct {
	Orders     int   `json:"orders"`
	Items      int   `json:"items"`
	ValueCents int64 `json:"value_cents"`
}

// OrderedMonth is the value ordered in one calendar month, by ordered_at.
type OrderedMonth struct {
	Month      string `json:"month"` // derived: YYYY-MM
	Orders     int    `json:"orders"`
	Items      int    `json:"items"`
	ValueCents int64  `json:"value_cents"`
}

// Forecast is the replacement demand over the next ForecastDays: for each live
// employee and item, the most recent GIVEN line whose service period ends
// before then (or has ended), unless the item is already on an ORDERED order
// for that employee. It assumes the same quantity again, costed at the item's
// current catalogue price.
type Forecast struct {
	Days  int `json:"days"`  // derived
	Items int `json:"items"` // total quantity
	// EstimatedCents covers the lines whose item is active and priced; the
	// rest are counted in Unpriced.
	EstimatedCents int64          `json:"estimated_cents"`
	Unpriced       int            `json:"unpriced"`
	Lines          []ForecastLine `json:"lines"` // by quantity, largest first
}

type ForecastLine struct {
	CatalogueItemID uuid.UUID `json:"catalogue_item_id"`
	ItemName        string    `json:"item_name"`
	Quantity        int       `json:"quantity"`
	Employees       int       `json:"employees"`
	// UnitPriceCents is the current catalogue price; nil when the item has
	// none, is inactive or was deleted, and then EstimatedCents is nil too.
	UnitPriceCents *int64 `json:"unit_price_cents"`
	EstimatedCents *int64 `json:"estimated_cents"`
	Overdue        int    `json:"overdue"` // of Quantity, already past due
}

// PriceChange is one catalogue.price_changed audit event.
type PriceChange struct {
	CatalogueItemID     uuid.UUID `json:"catalogue_item_id"`
	ItemName            string    `json:"item_name"`
	At                  time.Time `json:"at"`
	ByName              *string   `json:"by_name"`
	BeforeCents         *int64    `json:"before_cents"`
	AfterCents          *int64    `json:"after_cents"`
	BeforeServiceMonths *int      `json:"before_service_months"`
	AfterServiceMonths  *int      `json:"after_service_months"`
}

// CatalogueCheck is the live catalogue's state.
type CatalogueCheck struct {
	Active   int `json:"active"`
	Inactive int `json:"inactive"`
	// Unpriced are active items without a price or service period; Mark as
	// Ordered refuses them.
	Unpriced []ItemRef `json:"unpriced"`
	// NotOrdered are active, priced items on no order in the Months period.
	NotOrdered []ItemRef `json:"not_ordered"`
}

type ItemRef struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// ItemSetIssue is an active item set with lines that Apply Item Set will flag.
type ItemSetIssue struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	Inactive int       `json:"inactive"` // lines whose item is inactive or deleted
	Unpriced int       `json:"unpriced"` // lines whose active item has no price or service period
}

// SizeSpread counts live employees by the size Create Order would use: the
// saved size, or for clothing the one suggested from height.
type SizeSpread struct {
	Clothing []SizeCount `json:"clothing"` // vocabulary order, zeros included
	Shoes    []SizeCount `json:"shoes"`
	// NoClothing and NoShoes have no size to order in.
	NoClothing int `json:"no_clothing"`
	NoShoes    int `json:"no_shoes"`
	// Suggested of the clothing counts come from height, not a saved size.
	Suggested int `json:"suggested"`
}

type SizeCount struct {
	Size      string `json:"size"`
	Employees int    `json:"employees"`
}

// EmployeeSizes is one group of live employees with the same saved sizes and
// height, as the repository counts them.
type EmployeeSizes struct {
	ClothingSize *string
	HeightCm     *int
	ShoeSize     *string
	Employees    int
}

// ManagerFigures is what the repository reads; the service turns the size
// groups into the SizeSpread.
type ManagerFigures struct {
	ManagerOverview
	SizeGroups []EmployeeSizes
}
