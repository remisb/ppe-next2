// Package dashboard is the administrator's overview: read-only figures over
// orders, employees, the catalogue, item sets and users. It owns no table and
// writes nothing. Money, items and names of past orders come from the order
// snapshots, as in History; only the setup counts read live master data.
package dashboard

import (
	"time"

	"github.com/google/uuid"
)

const (
	// Months is how many calendar months the monthly figures cover, the
	// current one last.
	Months = 12
	// DueSoonDays is how far ahead a replacement counts as due soon.
	DueSoonDays = 30
	// ConfirmWindowDays is the period the confirmation figures describe.
	ConfirmWindowDays = 90
	// ListLimit caps the dashboard's lists (longest waiting, replacements, top items).
	ListLimit = 8
)

// Window is what the repository reads for, in storage terms (UTC instants).
type Window struct {
	Now time.Time
	// MonthStarts holds Months+1 instants: the start of each month in the
	// organisation's timezone, oldest first, then the end of the current month.
	MonthStarts []time.Time
	// DueBy is Now plus DueSoonDays: replacements due before it are listed.
	DueBy time.Time
	// ConfirmSince is Now minus ConfirmWindowDays.
	ConfirmSince time.Time
	Limit        int
}

// Overview is the whole dashboard. The repository fills the stored figures;
// the service adds the fields marked derived.
type Overview struct {
	GeneratedAt  time.Time    `json:"generated_at"`
	Timezone     string       `json:"timezone"`
	Awaiting     Awaiting     `json:"awaiting"`
	Months       []Month      `json:"months"`
	Confirmation Confirmation `json:"confirmation"`
	TopItems     []TopItem    `json:"top_items"`
	Replacements Replacements `json:"replacements"`
	Setup        Setup        `json:"setup"`
}

// Awaiting is every ORDERED order: ordered, not yet confirmed as received.
type Awaiting struct {
	Orders     int   `json:"orders"`
	ValueCents int64 `json:"value_cents"`
	// OldestDays is the age of the longest waiting order in calendar days
	// (derived); nil when nothing is waiting.
	OldestDays *int `json:"oldest_days"`
	// Longest are the longest waiting orders, oldest first.
	Longest []Waiting `json:"longest"`
}

type Waiting struct {
	OrderID      uuid.UUID `json:"order_id"`
	RecordSeq    int64     `json:"-"`
	RecordNumber string    `json:"record_number"` // derived
	EmployeeID   uuid.UUID `json:"employee_id"`
	EmployeeName string    `json:"employee_name"`
	OrderedAt    time.Time `json:"ordered_at"`
	Days         int       `json:"days"` // derived: calendar days waiting
	ValueCents   int64     `json:"value_cents"`
}

// Month is one calendar month in the organisation's timezone. Ordered figures
// count orders by ordered_at, given figures by given_at, so an order ordered in
// one month and given in the next appears in both.
type Month struct {
	Month         string `json:"month"` // derived: YYYY-MM
	OrderedOrders int    `json:"ordered_orders"`
	OrderedCents  int64  `json:"ordered_cents"`
	GivenOrders   int    `json:"given_orders"`
	GivenItems    int    `json:"given_items"`
	GivenCents    int64  `json:"given_cents"`
}

// Confirmation describes the orders given in the last ConfirmWindowDays.
type Confirmation struct {
	WindowDays int `json:"window_days"`
	Given      int `json:"given"`
	Electronic int `json:"electronic"`
	Paper      int `json:"paper"`
	// MedianSeconds is the median time from ordered to given; MedianDays is
	// the same in days to one decimal (derived). Both nil when none were given.
	MedianSeconds *float64 `json:"-"`
	MedianDays    *float64 `json:"median_days"`
}

// TopItem is an item by quantity given over the Months period. The name is the
// one on its most recent receipt.
type TopItem struct {
	CatalogueItemID uuid.UUID `json:"catalogue_item_id"`
	ItemName        string    `json:"item_name"`
	Quantity        int       `json:"quantity"`
	ValueCents      int64     `json:"value_cents"`
}

// Replacements are items whose service period has ended or ends within
// DueSoonDays: for each live employee and item, the most recent GIVEN line,
// due at given_at plus its service period, unless the item is already on an
// ORDERED order for that employee.
type Replacements struct {
	DueSoonDays int           `json:"due_soon_days"`
	Overdue     int           `json:"overdue"`
	DueSoon     int           `json:"due_soon"`
	Next        []Replacement `json:"next"` // soonest due first
}

type Replacement struct {
	EmployeeID      uuid.UUID `json:"employee_id"`
	EmployeeName    string    `json:"employee_name"`
	EmployeeCode    *string   `json:"employee_code"`
	CatalogueItemID uuid.UUID `json:"catalogue_item_id"`
	ItemName        string    `json:"item_name"`
	Size            *string   `json:"size"`
	OrderID         uuid.UUID `json:"order_id"`
	RecordSeq       int64     `json:"-"`
	RecordNumber    string    `json:"record_number"` // derived
	GivenAt         time.Time `json:"given_at"`
	DueAt           time.Time `json:"due_at"`
	Overdue         bool      `json:"overdue"` // derived
}

// Setup counts live master data, and what in it stops or slows ordering.
type Setup struct {
	Employees int `json:"employees"`
	// EmployeesMissingSizes have no shoe size, or neither a clothing size nor
	// a height to suggest one from: Create Order will flag a missing size.
	EmployeesMissingSizes int `json:"employees_missing_sizes"`
	CatalogueActive       int `json:"catalogue_active"`
	// CatalogueUnpriced are active items without a price or service period,
	// which Mark as Ordered refuses.
	CatalogueUnpriced int `json:"catalogue_unpriced"`
	ItemSetsActive    int `json:"item_sets_active"`
	Users             int `json:"users"`
	Admins            int `json:"admins"`
}
