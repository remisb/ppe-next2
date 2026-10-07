package main

import (
	"errors"
	"net/http"
	"runtime"
	"slices"
	"strconv"
	"time"

	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/backup"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/monitor"
	"github.com/remisb/ppe-next2/internal/overview"
	"github.com/remisb/ppe-next2/internal/security"
	"github.com/remisb/ppe-next2/internal/system"
)

// clientErrorsPerMinute bounds what one client may report; the apps send far
// fewer (a few a page at most).
const clientErrorsPerMinute = 20

// registerSystemRoutes mounts Administration's System screen
// (docs/specs/system-service.md): the API's status, request figures and
// database (system.read), the error list, the apps' error reports, and the
// Overview of what needs attention.
func registerSystemRoutes(rt *router, svc services, cfg config, tok *tokens) {
	rt.restricted("GET /api/v1/system/status", func(w http.ResponseWriter, r *http.Request) {
		st, err := systemStatus(r, svc, cfg)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, st)
	}, role.SystemRead)

	rt.restricted("GET /api/v1/system/errors", func(w http.ResponseWriter, r *http.Request) {
		f, err := errorFilter(r)
		if err != nil {
			writeError(w, r, err)
			return
		}
		page, err := svc.system.Errors(r.Context(), f)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, page)
	}, role.SystemRead)

	rt.restricted("GET /api/v1/system/errors/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := parseUUIDPath(r, "id")
		if err != nil {
			writeError(w, r, err)
			return
		}
		e, err := svc.system.Error(r.Context(), id)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, e)
	}, role.SystemRead)

	limiter := middleware.RateLimiter(middleware.RateLimitConfig{
		RequestsPerInterval: clientErrorsPerMinute, Interval: time.Minute, KeyFunc: middleware.ClientAddr,
	})
	rt.authenticated("POST /api/v1/client-errors", limiter(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req clientErrorRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeError(w, r, err)
			return
		}
		err := svc.system.Record(r.Context(), system.Report{
			Kind: system.KindClient, Route: system.ClientRoute(req.Path), Message: req.Message, Stack: req.Stack,
		})
		if err != nil {
			writeError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})).ServeHTTP)

	rt.authenticated("GET /api/v1/overview", func(w http.ResponseWriter, r *http.Request) {
		o, err := buildOverview(r, svc, tok)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, o)
	})
}

// clientErrorRequest is an error an app caught in the browser.
type clientErrorRequest struct {
	Message string `json:"message"`
	Stack   string `json:"stack"`
	// Path is the page's path; its ids are replaced before it is stored.
	Path string `json:"path"`
}

// errorFilter reads the error list's query parameters:
//
//	GET /api/v1/system/errors?kind=server|panic|client&after=<next>&page_size=
func errorFilter(r *http.Request) (system.ErrorFilter, error) {
	q := r.URL.Query()
	for k, v := range q {
		if (k != "kind" && k != "after" && k != "page_size") || len(v) > 1 {
			return system.ErrorFilter{}, errBadRequest
		}
	}
	f := system.ErrorFilter{Kind: system.Kind(q.Get("kind"))}
	if v := q.Get("after"); v != "" {
		c, err := audit.ParseCursor(v)
		if err != nil {
			return f, err
		}
		f.After = &c
	}
	if v := q.Get("page_size"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return f, errBadRequest
		}
		f.PageSize = n
	}
	return f, nil
}

// SystemStatus is GET /api/v1/system/status.
type SystemStatus struct {
	Service   ServiceStatus    `json:"service"`
	Requests  monitor.Requests `json:"requests"`
	Database  system.Database  `json:"database"`
	Pool      *PoolStatus      `json:"pool"`
	Retention Retention        `json:"retention"`
	Timezone  string           `json:"timezone"`
}

// ServiceStatus is the API process.
type ServiceStatus struct {
	Commit    string    `json:"commit"`
	GoVersion string    `json:"go_version"`
	StartedAt time.Time `json:"started_at"`
	// Ready is what GET /ready would answer; Problem names why not
	// (database or migrations).
	Ready   bool   `json:"ready"`
	Problem string `json:"problem,omitempty"`
}

// PoolStatus is the API's database connection pool.
type PoolStatus struct {
	Acquired int32 `json:"acquired"`
	Idle     int32 `json:"idle"`
	Max      int32 `json:"max"`
	// Waits counts acquires that had to wait for a free connection.
	Waits int64 `json:"waits"`
}

// Retention is how long each record is kept, as configured.
type Retention struct {
	AuditEventsDays  int    `json:"audit_events_days"`
	AuthEventsDays   int    `json:"auth_events_days"`
	ErrorEventsDays  int    `json:"error_events_days"`
	EndedSessionDays int    `json:"ended_session_days"`
	LastRun          JobRun `json:"last_run"`
}

func systemStatus(r *http.Request, svc services, cfg config) (SystemStatus, error) {
	st := SystemStatus{
		Service:  ServiceStatus{Commit: buildCommit(), GoVersion: runtime.Version(), StartedAt: svc.started, Ready: true},
		Requests: svc.window.Snapshot(time.Now()),
		Retention: Retention{
			AuditEventsDays:  int(svc.audit.Retention() / (24 * time.Hour)),
			AuthEventsDays:   int(cfg.AuthEventsRetention / (24 * time.Hour)),
			ErrorEventsDays:  int(system.Retention / (24 * time.Hour)),
			EndedSessionDays: 30,
			LastRun:          svc.jobs.get(),
		},
		Timezone: cfg.OrgTimezone,
	}
	if err := svc.ready.Ready(r.Context()); err != nil {
		st.Service.Ready, st.Service.Problem = false, "database"
		if errors.Is(err, errMigrationsPending) {
			st.Service.Problem = "migrations"
		}
	}
	db, err := svc.system.Database(r.Context())
	if err != nil {
		return st, err
	}
	st.Database = db
	if svc.pool != nil {
		s := svc.pool.Stat()
		st.Pool = &PoolStatus{Acquired: s.AcquiredConns(), Idle: s.IdleConns(), Max: s.MaxConns(), Waits: s.EmptyAcquireCount()}
	}
	return st, nil
}

// Overview is GET /api/v1/overview: what needs attention, then figures, of
// the areas the reader's permissions open (nil for the others).
type Overview struct {
	Attention []overview.Item   `json:"attention"`
	Users     *UserFigures      `json:"users"`
	Security  *security.Summary `json:"security"`
	Requests  *RequestFigures   `json:"requests"`
	Backups   *BackupFigures    `json:"backups"`
}

// UserFigures counts the accounts (users.read).
type UserFigures struct {
	Active   int `json:"active"`
	Inactive int `json:"inactive"`
}

// RequestFigures are the last 24 hours' requests and the database (system.read).
type RequestFigures struct {
	Since         time.Time `json:"since"`
	Requests      int       `json:"requests"`
	Errors        int       `json:"errors"`
	P95Ms         float64   `json:"p95_ms"`
	NewErrorKinds int       `json:"new_error_kinds"`
	DatabaseBytes int64     `json:"database_bytes"`
}

// BackupFigures are the newest backup and the verdicts (backups.read).
type BackupFigures struct {
	LastSuccessAt *time.Time `json:"last_success_at"`
	Stale         bool       `json:"stale"`
	AgentOffline  bool       `json:"agent_offline"`
	LastRunFailed bool       `json:"last_run_failed"`
}

func buildOverview(r *http.Request, svc services, tok *tokens) (Overview, error) {
	claims, err := tok.bearer(r)
	if err != nil {
		return Overview{}, err
	}
	perms := claims.permissions()
	can := func(p role.Permission) bool { return slices.Contains(perms, p) }
	ctx := r.Context()
	now := time.Now().UTC()
	out := Overview{}
	var in overview.Inputs

	if can(role.UsersRead) {
		users, err := svc.users.List(ctx)
		if err != nil {
			return out, err
		}
		out.Users = &UserFigures{}
		for _, u := range users {
			if u.IsActive {
				out.Users.Active++
			} else {
				out.Users.Inactive++
			}
		}
	}
	if can(role.BackupsRead) {
		st, err := svc.backups.Status(ctx)
		if err != nil {
			return out, err
		}
		out.Backups = backupFigures(st)
		in.Backups = &overview.Backups{Stale: st.Stale, AgentOffline: st.AgentOffline, LastRunFailed: st.LastRunFailed}
	}
	if can(role.SecurityRead) {
		sum, err := svc.security.Summary(ctx)
		if err != nil {
			return out, err
		}
		out.Security = &sum
		in.Security = &overview.Security{
			CopiedSignIns: sum.CopiedSignIns, FailedLastHour: sum.FailedLastHour,
			MostAtOneAccount: sum.MostAtOneAccount, LastReview: sum.LastReview,
		}
	}
	if can(role.SystemRead) {
		win := svc.window.Snapshot(now)
		kinds, err := svc.system.NewErrorKinds(ctx)
		if err != nil {
			return out, err
		}
		db, err := svc.system.Database(ctx)
		if err != nil {
			return out, err
		}
		out.Requests = &RequestFigures{
			Since: win.Since, Requests: win.Requests, Errors: win.Errors, P95Ms: win.P95Ms,
			NewErrorKinds: kinds, DatabaseBytes: db.Bytes,
		}
		in.Errors = &overview.Errors{LastHourRequests: win.LastHour.Requests, LastHourErrors: win.LastHour.Errors, NewKinds: kinds}
		in.Database = &overview.Database{Bytes: db.Bytes, OwnerRights: db.OwnerRights}
		if db.Earlier != nil {
			in.Database.EarlierBytes, in.Database.EarlierDay = db.Earlier.Bytes, db.Earlier.Day
		}
	}
	if can(role.AuditRead) {
		in.Audit = &overview.Audit{}
		if v := svc.audit.LastVerification(); v != nil {
			if v.Mismatch != nil {
				in.Audit.MismatchDay = v.Mismatch.Day
			}
			in.Audit.StampsOverdue = v.StampsOverdue
		}
	}
	out.Attention = overview.Attention(in, now)
	return out, nil
}

func backupFigures(st backup.Status) *BackupFigures {
	f := &BackupFigures{Stale: st.Stale, AgentOffline: st.AgentOffline, LastRunFailed: st.LastRunFailed}
	if st.LastSuccess != nil {
		at := st.LastSuccess.FinishedAt
		f.LastSuccessAt = &at
	}
	return f
}
