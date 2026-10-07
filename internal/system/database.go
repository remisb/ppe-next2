package system

import "time"

// Table is one of the database's largest tables.
type Table struct {
	Name string `json:"name"`
	// Bytes counts its indexes and TOAST too.
	Bytes int64 `json:"bytes"`
	// Rows is Postgres's estimate, from the last ANALYZE.
	Rows int64 `json:"rows"`
}

// Migration is the latest applied migration.
type Migration struct {
	File      string    `json:"file"`
	AppliedAt time.Time `json:"applied_at"`
}

// Sample is the database's size on a day.
type Sample struct {
	Day   time.Time `json:"day"`
	Bytes int64     `json:"bytes"`
}

// Database is the database as the System screen shows it.
type Database struct {
	Version string `json:"version"`
	// User is the role the API connects as. OwnerRights is true when it is a
	// superuser or owns the tables, so it could switch the trails' triggers
	// off: production connects as ppe_app (migration 0026) instead.
	User        string `json:"user"`
	OwnerRights bool   `json:"owner_rights"`
	Bytes       int64  `json:"bytes"`
	// Earlier is the size at least GrowthSpan ago, or the earliest sample
	// when there is none that old; nil before the first sample.
	Earlier *Sample `json:"earlier"`
	Tables  []Table `json:"tables"`
	// Connections counts this database's server connections by state
	// (active, idle, idle in transaction …).
	Connections    map[string]int `json:"connections"`
	MaxConnections int            `json:"max_connections"`
	// OldestTransactionSeconds is the age of the oldest open transaction
	// other than this query's; 0 when there is none.
	OldestTransactionSeconds float64    `json:"oldest_transaction_seconds"`
	LatestMigration          *Migration `json:"latest_migration"`
}

// GrowthSpan is how far back the Overview compares the database's size.
const GrowthSpan = 30 * 24 * time.Hour

// TableLimit is how many tables Database lists, largest first.
const TableLimit = 8
