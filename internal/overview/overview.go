// Package overview decides Administration's attention items: what needs an
// administrator now, worst first, from figures the API gathers from the
// backups, the security log, the request window and the database. The rules
// are here, pure and tested; cmd/api gathers the figures each reader may see.
package overview

import (
	"slices"
	"time"
)

// Severity orders the items: critical first.
type Severity string

const (
	Critical Severity = "critical"
	Warning  Severity = "warning"
	Info     Severity = "info"
)

var order = []Severity{Critical, Warning, Info}

// The items, by key. The apps word each one and link to where it is resolved.
const (
	// BackupsNotRunning: no recent successful backup, or the agent is silent.
	BackupsNotRunning = "backups_not_running"
	// LastBackupFailed: the newest backup run failed (backups are still recent).
	LastBackupFailed = "last_backup_failed"
	// CopiedSignIn: a replaced refresh token came back in the last week.
	CopiedSignIn = "copied_sign_in"
	// FailedSignIns: many failed sign-ins in the last hour, overall or at one account.
	FailedSignIns = "failed_sign_ins"
	// ErrorRate: at least ErrorRateShare of the last hour's requests failed.
	ErrorRate = "error_rate"
	// NewErrors: kinds of error first seen in the last day.
	NewErrors = "new_errors"
	// ReviewOverdue: access has not been reviewed within ReviewEvery.
	ReviewOverdue = "review_overdue"
	// DatabaseGrowth: the database grew over GrowthShare in GrowthSpan days.
	DatabaseGrowth = "database_growth"
)

// keys is every item, in the order Attention can list them; @ppe/api-client's
// ATTENTION_KEYS mirrors it (TestWebClientListsTheKeys).
var allKeys = []string{
	BackupsNotRunning, LastBackupFailed, CopiedSignIn, FailedSignIns,
	ErrorRate, NewErrors, ReviewOverdue, DatabaseGrowth,
}

// Keys returns every item's key.
func Keys() []string { return slices.Clone(allKeys) }

// The rules' thresholds.
const (
	CopiedSignInWithin = 7 * 24 * time.Hour
	// FailedPerHour failed sign-ins in the last hour, or FailedPerAccount at
	// one account, raise FailedSignIns.
	FailedPerHour    = 20
	FailedPerAccount = 5
	// ErrorRateShare of the last hour's requests failing raises ErrorRate,
	// once there are ErrorRateMinRequests to judge by.
	ErrorRateShare       = 0.01
	ErrorRateMinRequests = 50
	ReviewEvery          = 90 * 24 * time.Hour
	GrowthShare          = 0.20
)

// Item is one thing that needs attention. Count, Percent and Days carry the
// figure the words need; Since is when the condition started, where known.
type Item struct {
	Key      string     `json:"key"`
	Severity Severity   `json:"severity"`
	Count    int        `json:"count,omitempty"`
	Percent  float64    `json:"percent,omitempty"`
	Days     int        `json:"days,omitempty"`
	Since    *time.Time `json:"since,omitempty"`
}

// Backups are the backup status's verdicts (backup.Status).
type Backups struct {
	Stale, AgentOffline, LastRunFailed bool
}

// Security is the security log's recent figures.
type Security struct {
	CopiedSignIns int // refresh_reused in the last CopiedSignInWithin
	// FailedLastHour counts failed sign-ins and confirmations in the last
	// hour; MostAtOneAccount is the most at one email.
	FailedLastHour   int
	MostAtOneAccount int
	// LastReview is the latest access_review.completed; nil for never.
	LastReview *time.Time
}

// Errors are the request window's last hour and the error list's new kinds.
type Errors struct {
	LastHourRequests, LastHourErrors int
	NewKinds                         int
}

// Database is the database's size now and earlier (system.Database).
type Database struct {
	Bytes        int64
	EarlierBytes int64
	EarlierDay   time.Time // zero when there is no earlier sample
}

// Inputs are the figures the reader may see; nil leaves an area out.
type Inputs struct {
	Backups  *Backups
	Security *Security
	Errors   *Errors
	Database *Database
}

// Attention is what needs attention at now, critical first.
func Attention(in Inputs, now time.Time) []Item {
	out := make([]Item, 0)
	if b := in.Backups; b != nil {
		switch {
		case b.Stale || b.AgentOffline:
			out = append(out, Item{Key: BackupsNotRunning, Severity: Critical})
		case b.LastRunFailed:
			out = append(out, Item{Key: LastBackupFailed, Severity: Warning})
		}
	}
	if s := in.Security; s != nil {
		if s.CopiedSignIns > 0 {
			out = append(out, Item{Key: CopiedSignIn, Severity: Critical, Count: s.CopiedSignIns})
		}
		if s.FailedLastHour > FailedPerHour || s.MostAtOneAccount > FailedPerAccount {
			out = append(out, Item{Key: FailedSignIns, Severity: Warning, Count: s.FailedLastHour})
		}
		switch {
		case s.LastReview == nil:
			out = append(out, Item{Key: ReviewOverdue, Severity: Warning})
		case now.Sub(*s.LastReview) > ReviewEvery:
			at := *s.LastReview
			out = append(out, Item{Key: ReviewOverdue, Severity: Warning, Days: int(now.Sub(at).Hours() / 24), Since: &at})
		}
	}
	if e := in.Errors; e != nil {
		if e.LastHourRequests >= ErrorRateMinRequests && float64(e.LastHourErrors) >= ErrorRateShare*float64(e.LastHourRequests) {
			out = append(out, Item{
				Key: ErrorRate, Severity: Warning, Count: e.LastHourErrors,
				Percent: float64(int(1000*float64(e.LastHourErrors)/float64(e.LastHourRequests))) / 10,
			})
		}
		if e.NewKinds > 0 {
			out = append(out, Item{Key: NewErrors, Severity: Warning, Count: e.NewKinds})
		}
	}
	if d := in.Database; d != nil && !d.EarlierDay.IsZero() && d.EarlierBytes > 0 && now.Sub(d.EarlierDay) >= 7*24*time.Hour {
		if grew := float64(d.Bytes-d.EarlierBytes) / float64(d.EarlierBytes); grew > GrowthShare {
			day := d.EarlierDay
			out = append(out, Item{
				Key: DatabaseGrowth, Severity: Info, Percent: float64(int(grew*1000)) / 10,
				Days: int(now.Sub(day).Hours() / 24), Since: &day,
			})
		}
	}
	slices.SortStableFunc(out, func(a, b Item) int {
		return slices.Index(order, a.Severity) - slices.Index(order, b.Severity)
	})
	return out
}
