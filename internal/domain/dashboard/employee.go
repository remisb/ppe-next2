package dashboard

import (
	"time"

	"github.com/google/uuid"
)

// Link states of an ORDERED order's confirmation link: its most recent
// electronic confirmation row, if any.
const (
	LinkNone    = "NONE"    // no link was ever created
	LinkActive  = "ACTIVE"  // the latest link is still usable
	LinkExpired = "EXPIRED" // the latest link has expired or was revoked
)

// EmployeeWindow is what the repository reads for the dashboard of the
// employee role: the staff who prepare orders.
type EmployeeWindow struct {
	Now time.Time
	// UserID is the signed-in user; "your orders" are those they marked as ordered.
	UserID uuid.UUID
	// MonthStarts is as in Window: Months+1 local month starts in UTC.
	MonthStarts []time.Time
	// DueBy is Now plus DueSoonDays, as in Window.
	DueBy time.Time
	Limit int
}

// EmployeeOverview is the order preparer's dashboard: their own orders still
// waiting for the employee's confirmation, their recent work, and the
// organisation-wide list of what to order next and whose sizes are missing.
type EmployeeOverview struct {
	GeneratedAt time.Time `json:"generated_at"`
	Timezone    string    `json:"timezone"`
	// Awaiting are the user's ORDERED orders.
	Awaiting MyAwaiting `json:"awaiting"`
	// Months counts the user's orders: ordered by ordered_at, given by given_at.
	Months []MyMonth `json:"months"`
	// RecentlyGiven are the user's orders most recently given, newest first.
	RecentlyGiven []GivenOrder `json:"recently_given"`
	Replacements  Replacements `json:"replacements"`
	MissingSizes  MissingSizes `json:"missing_sizes"`
}

type MyAwaiting struct {
	Orders     int   `json:"orders"`
	Items      int   `json:"items"`
	ValueCents int64 `json:"value_cents"`
	// NoLink and LinkExpired count the orders whose employee has no usable
	// confirmation link: one needs creating before they can confirm.
	NoLink      int  `json:"no_link"`
	LinkExpired int  `json:"link_expired"`
	OldestDays  *int `json:"oldest_days"` // derived, as in Awaiting
	// Longest are the longest waiting, oldest first.
	Longest []MyWaiting `json:"longest"`
}

type MyWaiting struct {
	Waiting
	Items int `json:"items"`
	// Link is LinkNone, LinkActive or LinkExpired; LinkExpiresAt is set for
	// an active link.
	Link          string     `json:"link"`
	LinkExpiresAt *time.Time `json:"link_expires_at"`
}

// MyMonth is one calendar month of the user's orders.
type MyMonth struct {
	Month   string `json:"month"` // derived: YYYY-MM
	Ordered int    `json:"ordered"`
	Given   int    `json:"given"`
	// GivenItems is the quantity on the orders given in the month.
	GivenItems int `json:"given_items"`
}

type GivenOrder struct {
	OrderID      uuid.UUID `json:"order_id"`
	RecordSeq    int64     `json:"-"`
	RecordNumber string    `json:"record_number"` // derived
	EmployeeID   uuid.UUID `json:"employee_id"`
	EmployeeName string    `json:"employee_name"`
	GivenAt      time.Time `json:"given_at"`
	Method       string    `json:"method"` // ELECTRONIC or PAPER
	Items        int       `json:"items"`
	ValueCents   int64     `json:"value_cents"`
}

// MissingSizes are live employees without a shoe size, or without both a
// clothing size and a height to suggest one: Create Order flags their lines.
type MissingSizes struct {
	Employees int                   `json:"employees"`
	List      []EmployeeMissingSize `json:"list"` // by name
}

type EmployeeMissingSize struct {
	EmployeeID   uuid.UUID `json:"employee_id"`
	EmployeeName string    `json:"employee_name"`
	EmployeeCode *string   `json:"employee_code"`
	Clothing     bool      `json:"clothing"` // no clothing size and no height
	Shoes        bool      `json:"shoes"`    // no shoe size
}
