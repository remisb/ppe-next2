// Package backup reports the database backups: when they ran, how big they
// are, and whether one is overdue or failed. It only reads. The backup agent,
// a separate service built from github.com/remisb/dbbackup (docs/backups.md),
// writes the dbbackup_runs and dbbackup_agents tables (migration 0019).
package backup

import "time"

const (
	// RunLimit caps the recent runs listed.
	RunLimit = 30
	// Grace is how late a scheduled backup may be before it counts as overdue.
	Grace = 2 * time.Hour
	// DefaultInterval is the expected gap between backups when no agent has
	// said what its schedule is.
	DefaultInterval = 24 * time.Hour
	// OfflineAfter is how long without a heartbeat (written every 5 minutes)
	// before the agent counts as stopped.
	OfflineAfter = 15 * time.Minute
)

// Status is everything the Backups screen and the Dashboard tile show. The
// repository fills the stored fields; the service adds the ones marked derived.
type Status struct {
	GeneratedAt time.Time `json:"generated_at"` // derived
	// Timezone is the organisation's, which the screen shows times in (derived).
	Timezone string `json:"timezone"`
	// Agent is the agent that reported most recently; nil when none ever did.
	Agent *Agent `json:"agent"`
	// LastSuccess is the newest successful backup; nil when there is none.
	LastSuccess *Run `json:"last_success"`
	// Runs are the newest RunLimit runs, successful or not, newest first.
	Runs []Run `json:"runs"`
	Kept Kept  `json:"kept"`
	// Stale: there is no successful backup, or the newest is older than the
	// agent's interval plus Grace (derived).
	Stale bool `json:"stale"`
	// AgentOffline: no agent, or none reported within OfflineAfter (derived).
	AgentOffline bool `json:"agent_offline"`
	// LastRunFailed: the newest run failed (derived).
	LastRunFailed bool `json:"last_run_failed"`
}

// Run is one backup attempt.
type Run struct {
	ID            string    `json:"id"`
	StartedAt     time.Time `json:"started_at"`
	FinishedAt    time.Time `json:"finished_at"`
	DurationMS    int64     `json:"duration_ms"` // derived
	Status        string    `json:"status"`      // succeeded | failed
	Error         string    `json:"error"`
	SizeBytes     int64     `json:"size_bytes"`
	ServerVersion string    `json:"server_version"`
	ToolVersion   string    `json:"tool_version"`
	Target        string    `json:"target"`
	Key           string    `json:"key"`
	Encrypted     bool      `json:"encrypted"`
	// Pruned: retention has deleted the file.
	Pruned bool `json:"pruned"`
}

const (
	StatusSucceeded = "succeeded"
	StatusFailed    = "failed"
)

// Agent is the backup service as it last reported itself.
type Agent struct {
	Name            string     `json:"name"`
	Schedule        string     `json:"schedule"`
	Timezone        string     `json:"timezone"`
	IntervalSeconds int64      `json:"interval_seconds"`
	Target          string     `json:"target"`
	Retention       string     `json:"retention"`
	Encrypted       bool       `json:"encrypted"`
	Version         string     `json:"version"`
	NextRunAt       *time.Time `json:"next_run_at"`
	LastSeenAt      time.Time  `json:"last_seen_at"`
}

// Kept counts the stored backups: successful runs whose file retention has
// not deleted.
type Kept struct {
	Count int   `json:"count"`
	Bytes int64 `json:"bytes"`
}
