package main

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// jobEvery is how often the API runs its upkeep.
const jobEvery = time.Hour

// jobRuns is when the upkeep last ran and what it deleted, for System.
type jobRuns struct {
	mu   sync.Mutex
	last JobRun
}

// JobRun is one run of the upkeep.
type JobRun struct {
	At *time.Time `json:"at"`
	// AuthEventsDeleted and ErrorEventsDeleted are what the purges deleted.
	AuthEventsDeleted  int64 `json:"auth_events_deleted"`
	ErrorEventsDeleted int64 `json:"error_events_deleted"`
	// Failed is true when a part of it failed; the log says why.
	Failed bool `json:"failed"`
}

func (j *jobRuns) get() JobRun {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.last
}

// runJobs does the API's upkeep when it starts and then every jobEvery,
// until ctx ends, until ADR 0001's worker exists:
//   - deletes security events older than API_AUTH_EVENTS_RETENTION (the
//     store holds an advisory lock, so with several instances one does it);
//   - deletes error list rows not seen for 30 days;
//   - records today's database size, for its growth.
func runJobs(ctx context.Context, svc services, logger *slog.Logger) {
	tick := time.NewTicker(jobEvery)
	defer tick.Stop()
	for {
		run := JobRun{}
		var err error
		if run.AuthEventsDeleted, err = svc.security.Purge(ctx); err != nil && ctx.Err() == nil {
			run.Failed = true
			logger.Error("security events purge failed", slog.Any("error", err))
		}
		if run.ErrorEventsDeleted, err = svc.system.Purge(ctx); err != nil && ctx.Err() == nil {
			run.Failed = true
			logger.Error("error list purge failed", slog.Any("error", err))
		}
		if err := svc.system.SampleSize(ctx); err != nil && ctx.Err() == nil {
			run.Failed = true
			logger.Error("database size sample failed", slog.Any("error", err))
		}
		if run.AuthEventsDeleted > 0 || run.ErrorEventsDeleted > 0 {
			logger.Info("purged", slog.Int64("security_events", run.AuthEventsDeleted), slog.Int64("error_events", run.ErrorEventsDeleted))
		}
		at := time.Now().UTC()
		run.At = &at
		svc.jobs.mu.Lock()
		svc.jobs.last = run
		svc.jobs.mu.Unlock()
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
