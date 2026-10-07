package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"time"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/usage"
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
	// AuthEventsDeleted, ErrorEventsDeleted and AuditEventsDeleted are what
	// the purges deleted; DaysSealed the audit days it sealed.
	AuthEventsDeleted  int64 `json:"auth_events_deleted"`
	ErrorEventsDeleted int64 `json:"error_events_deleted"`
	AuditEventsDeleted int64 `json:"audit_events_deleted"`
	DaysSealed         int   `json:"days_sealed"`
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
//   - records today's database size, for its growth, and today's setup
//     figures and deletes old activity, for the Usage screen;
//   - seals the audit days that have ended, purges audit events older than
//     API_AUDIT_RETENTION (sealed days only), and verifies every seal, which
//     the Overview reports on.
func runJobs(ctx context.Context, svc services, logger *slog.Logger) {
	tick := time.NewTicker(jobEvery)
	defer tick.Stop()
	for {
		run := upkeep(ctx, svc, logger)
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

// upkeep runs the upkeep once (runJobs, and the -upkeep mode) and says what it
// did; a part that fails is logged and the rest still run.
func upkeep(ctx context.Context, svc services, logger *slog.Logger) JobRun {
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
	if _, err := svc.usage.PurgeActivity(ctx); err != nil && ctx.Err() == nil {
		run.Failed = true
		logger.Error("usage activity purge failed", slog.Any("error", err))
	}
	if setup, err := svc.dashboard.Setup(ctx); err == nil {
		err = svc.usage.SampleQuality(ctx, usage.Quality{
			Employees: setup.Employees, EmployeesMissingSizes: setup.EmployeesMissingSizes,
			CatalogueActive: setup.CatalogueActive, CatalogueUnpriced: setup.CatalogueUnpriced, ItemSetsActive: setup.ItemSetsActive,
		})
		if err != nil && ctx.Err() == nil {
			run.Failed = true
			logger.Error("data quality sample failed", slog.Any("error", err))
		}
	} else if ctx.Err() == nil {
		run.Failed = true
		logger.Error("data quality sample failed", slog.Any("error", err))
	}
	if run.DaysSealed, err = svc.audit.SealDays(ctx); err != nil && ctx.Err() == nil {
		run.Failed = true
		logger.Error("audit sealing failed", slog.Any("error", err))
	}
	if run.AuditEventsDeleted, err = svc.audit.PurgeExpired(ctx); err != nil && ctx.Err() == nil {
		run.Failed = true
		logger.Error("audit purge failed", slog.Any("error", err))
	}
	if v, err := svc.audit.Verify(ctx); err != nil && ctx.Err() == nil {
		run.Failed = true
		logger.Error("audit verification failed to run", slog.Any("error", err))
	} else if err == nil && !v.OK {
		logger.Error("audit seals do not match", slog.Time("day", v.Mismatch.Day), slog.String("problem", v.Mismatch.Problem))
	}
	if run.AuthEventsDeleted > 0 || run.ErrorEventsDeleted > 0 || run.AuditEventsDeleted > 0 {
		logger.Info("purged", slog.Int64("security_events", run.AuthEventsDeleted), slog.Int64("error_events", run.ErrorEventsDeleted),
			slog.Int64("audit_events", run.AuditEventsDeleted))
	}
	at := time.Now().UTC()
	run.At = &at
	return run
}

// verifyAudit is the -verify-audit mode, for the restore drill
// (deploy/restore-drill.sh): it checks the Audit log against its seals, as
// the upkeep and Audit log → Verify do, writes what it found to out as JSON,
// and fails on a mismatch.
func verifyAudit(ctx context.Context, a interface {
	Verify(context.Context) (audit.Verification, error)
}, out io.Writer) error {
	v, err := a.Verify(ctx)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return err
	}
	if !v.OK {
		return fmt.Errorf("audit seals do not match from %s: %s", v.Mismatch.Day.Format(time.DateOnly), v.Mismatch.Problem)
	}
	return nil
}
