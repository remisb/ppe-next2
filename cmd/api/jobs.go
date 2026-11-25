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

// archiveSweepWindow is how far back the upkeep looks for records whose
// archiving was missed; -vault-backfill looks at all of them.
const archiveSweepWindow = 7 * 24 * time.Hour

// jobRuns is when the upkeep last ran and what it deleted, for System.
type jobRuns struct {
	mu   sync.Mutex
	last JobRun
}

// JobRun is one run of the upkeep.
type JobRun struct {
	At *time.Time `json:"at"`
	// AuthEventsDeleted, ErrorEventsDeleted and AuditEventsDeleted are what
	// the purges deleted; DaysSealed the audit days it sealed, DaysStamped
	// the seals it got a trusted timestamp for.
	AuthEventsDeleted  int64 `json:"auth_events_deleted"`
	ErrorEventsDeleted int64 `json:"error_events_deleted"`
	AuditEventsDeleted int64 `json:"audit_events_deleted"`
	DaysSealed         int   `json:"days_sealed"`
	DaysStamped        int   `json:"days_stamped"`
	// ScansPurged are the kept scans that expired and were erased.
	ScansPurged int `json:"scans_purged"`
	// SharesErased are the shared links that expired and whose rows were erased.
	SharesErased int `json:"shares_erased"`
	// JobsPurged are the worker's finished jobs deleted (done after 7 days, failed after 90).
	JobsPurged int64 `json:"jobs_purged"`
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
//     the Overview reports on;
//   - shreds personnel files whose retention has ended, erases expired kept scans
//     and the rows of expired shared links;
//   - shreds sealed documents past their retention and names documents' links
//     as their subjects are called now.
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
	if run.DaysStamped, err = svc.audit.StampDays(ctx); err != nil && ctx.Err() == nil {
		run.Failed = true
		logger.Error("audit timestamping failed", slog.Any("error", err))
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
	// Personnel files whose retention has ended (D3) are shredded; a rule
	// applied every run, so it shreds again after a restore.
	if svc.documents != nil && svc.personnelRetentionMonths > 0 {
		if res, err := svc.documents.ShredDue(ctx, svc.personnelRetentionMonths, logger); err != nil && ctx.Err() == nil {
			run.Failed = true
			logger.Error("personnel files shredding failed", slog.Any("error", err))
		} else if res.Failed > 0 {
			run.Failed = true
		} else if res.Files > 0 {
			logger.Info("personnel files shredded", slog.Int("files", res.Files))
		}
	}
	// Kept scans past API_PERSONNEL_SCAN_DAYS are erased: their rows (and
	// keys), then their objects.
	if svc.scans != nil {
		if run.ScansPurged, err = svc.scans.PurgeExpired(ctx, logger); err != nil && ctx.Err() == nil {
			run.Failed = true
			logger.Error("kept scans purge failed", slog.Any("error", err))
		} else if run.ScansPurged > 0 {
			logger.Info("kept scans purged", slog.Int("scans", run.ScansPurged))
		}
	}
	// Shared links that have expired lose their rows (WARE-51).
	if svc.shares != nil {
		if run.SharesErased, err = svc.shares.EraseExpired(ctx); err != nil && ctx.Err() == nil {
			run.Failed = true
			logger.Error("shared links erasing failed", slog.Any("error", err))
		} else if run.SharesErased > 0 {
			logger.Info("shared links erased", slog.Int("shares", run.SharesErased))
		}
	}
	// Sealed documents past their retention, or removed, are shredded unless held (ADR 0008).
	if svc.vault != nil {
		if res, err := svc.vault.ShredDue(ctx, logger); err != nil && ctx.Err() == nil {
			run.Failed = true
			logger.Error("document shredding failed", slog.Any("error", err))
		} else if res.Failed > 0 {
			run.Failed = true
		} else if res.Documents > 0 {
			logger.Info("documents shredded", slog.Int("documents", res.Documents))
		}
	}
	// DOCX renders an hour old, with their sealed files (phase 8).
	if svc.vault != nil {
		if n, err := svc.vault.PurgeRenders(ctx, logger); err != nil && ctx.Err() == nil {
			run.Failed = true
			logger.Error("render purge failed", slog.Any("error", err))
		} else if n > 0 {
			logger.Info("renders purged", slog.Int("renders", n))
		}
	}
	// The worker's finished jobs, and workers long gone.
	if svc.outbox != nil {
		if run.JobsPurged, err = svc.outbox.Purge(ctx); err != nil && ctx.Err() == nil {
			run.Failed = true
			logger.Error("outbox purge failed", slog.Any("error", err))
		}
	}
	// Stored forms and given orders of the last week whose archiving was
	// missed (a failed queueing, an API stopped mid-way) are queued again.
	if svc.vault != nil && svc.assets != nil && svc.orders != nil {
		if sw, err := sweepArchives(ctx, svc, time.Now().Add(-archiveSweepWindow), true); err != nil && ctx.Err() == nil {
			run.Failed = true
			logger.Error("archive sweep failed", slog.Any("error", err))
		} else if sw.Forms > 0 || sw.Records > 0 {
			logger.Info("archiving queued by the sweep", slog.Int("forms", sw.Forms), slog.Int("records", sw.Records))
		}
	}
	// Documents' links are named as their subjects are called now (a renamed
	// employee, asset or company), for the lists and search.
	if svc.vault != nil {
		if n, err := svc.vault.RefreshLabels(ctx); err != nil && ctx.Err() == nil {
			run.Failed = true
			logger.Error("document link names failed", slog.Any("error", err))
		} else if n > 0 {
			logger.Info("document link names refreshed", slog.Int("links", n))
		}
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
