package main

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/role"
)

// auditParams are the only query parameters the Audit log accepts. Its filters
// combine freely, so they are query parameters, the exception the domain
// contract allows for paged search lists (as GET /api/v1/orders).
var auditParams = map[string]bool{
	"area": true, "event": true, "actor": true, "entity_type": true, "entity_id": true,
	"from": true, "to": true, "after": true, "page_size": true,
}

// registerAuditRoutes mounts the Audit log (docs/specs/audit-service.md): the
// whole trail for whoever may read it, and each record's History for whoever
// may open the record. A History route asks the record's own service first,
// so a record that does not exist (or is deleted) is a 404, as its page is.
func registerAuditRoutes(rt *router, svc services) {
	rt.restricted("GET /api/v1/audit-events", func(w http.ResponseWriter, r *http.Request) {
		f, err := auditFilter(r)
		if err != nil {
			writeError(w, r, err)
			return
		}
		page, err := svc.audit.List(r.Context(), f)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, page)
	}, role.AuditRead)

	rt.restricted("GET /api/v1/audit-events/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := parseUUIDPath(r, "id")
		if err != nil {
			writeError(w, r, err)
			return
		}
		e, err := svc.audit.Get(r.Context(), id)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, e)
	}, role.AuditRead)

	rt.restricted("GET /api/v1/audit-events/integrity", func(w http.ResponseWriter, r *http.Request) {
		in, err := auditIntegrity(r, svc)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, in)
	}, role.AuditRead)

	rt.restricted("POST /api/v1/audit-events/verify", func(w http.ResponseWriter, r *http.Request) {
		v, err := svc.audit.Verify(r.Context())
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, v)
	}, role.AuditRead)

	rt.restricted("GET /api/v1/audit-events/export", func(w http.ResponseWriter, r *http.Request) {
		actor, err := actorID(r)
		if err != nil {
			writeError(w, r, err)
			return
		}
		format := r.URL.Query().Get("format")
		q := r.URL.Query()
		q.Del("format")
		r2 := r.Clone(r.Context())
		r2.URL.RawQuery = q.Encode()
		f, err := auditFilter(r2)
		if err != nil {
			writeError(w, r, err)
			return
		}
		// The headers go out with the first byte, so a refused export is
		// still answered as an error.
		out := &attachment{w: w, format: format, name: "audit-log-" + f.FromDate + "-" + f.ToDate + "." + format}
		if err := svc.audit.Export(r.Context(), f, format, actor, out); err != nil {
			if out.started {
				slog.ErrorContext(r.Context(), "audit export cut short", slog.Any("error", err))
				return
			}
			writeError(w, r, err)
		}
	}, role.AuditExport)

	history := func(entityType string, exists func(ctx context.Context, id uuid.UUID) error) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			id, err := parseUUIDPath(r, "id")
			if err != nil {
				writeError(w, r, err)
				return
			}
			if err := exists(r.Context(), id); err != nil {
				writeError(w, r, err)
				return
			}
			events, err := svc.audit.History(r.Context(), entityType, id)
			if err != nil {
				writeError(w, r, err)
				return
			}
			writeJSON(w, http.StatusOK, events)
		}
	}
	rt.authenticated("GET /api/v1/audit-events/employees/{id}", history("employee", func(ctx context.Context, id uuid.UUID) error {
		_, err := svc.employees.Get(ctx, id)
		return err
	}))
	rt.authenticated("GET /api/v1/audit-events/catalogue/{id}", history("catalogue_item", func(ctx context.Context, id uuid.UUID) error {
		_, err := svc.catalogue.Get(ctx, id)
		return err
	}))
	rt.authenticated("GET /api/v1/audit-events/orders/{id}", history("order", func(ctx context.Context, id uuid.UUID) error {
		_, err := svc.orders.Get(ctx, id)
		return err
	}))
	rt.authenticated("GET /api/v1/audit-events/assets/{id}", history("asset", func(ctx context.Context, id uuid.UUID) error {
		_, err := svc.assets.Get(ctx, id)
		return err
	}))
	rt.restricted("GET /api/v1/audit-events/users/{id}", history("user", func(ctx context.Context, id uuid.UUID) error {
		_, err := svc.users.Get(ctx, id)
		return err
	}), role.UsersRead)
}

// auditFilter reads the Audit log's query parameters; the service checks
// their values.
//
//	GET /api/v1/audit-events?area=&event=&actor=<user id>&entity_type=&entity_id=
//	    &from=YYYY-MM-DD&to=YYYY-MM-DD&after=<next>&page_size=
func auditFilter(r *http.Request) (audit.Filter, error) {
	q := r.URL.Query()
	for k, v := range q {
		if !auditParams[k] || len(v) > 1 {
			return audit.Filter{}, errBadRequest
		}
	}
	f := audit.Filter{
		Area: audit.Area(q.Get("area")), Event: q.Get("event"), EntityType: q.Get("entity_type"),
		FromDate: q.Get("from"), ToDate: q.Get("to"),
	}
	for _, p := range []struct {
		key string
		dst **uuid.UUID
	}{{"actor", &f.ActorID}, {"entity_id", &f.EntityID}} {
		if v := q.Get(p.key); v != "" {
			id, err := uuid.Parse(v)
			if err != nil {
				return audit.Filter{}, errBadRequest
			}
			*p.dst = &id
		}
	}
	if v := q.Get("after"); v != "" {
		c, err := audit.ParseCursor(v)
		if err != nil {
			return audit.Filter{}, err
		}
		f.After = &c
	}
	if v := q.Get("page_size"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return audit.Filter{}, errBadRequest
		}
		f.PageSize = n
	}
	return f, nil
}

// attachment writes an export's headers before its first byte.
type attachment struct {
	w       http.ResponseWriter
	format  string
	name    string
	started bool
}

func (a *attachment) Write(b []byte) (int, error) {
	if !a.started {
		a.started = true
		ct := "text/csv; charset=utf-8"
		if a.format == audit.FormatJSONL {
			ct = "application/x-ndjson"
		}
		h := a.w.Header()
		h.Set("Content-Type", ct)
		h.Set("Content-Disposition", `attachment; filename="`+a.name+`"`)
		h.Set("Cache-Control", "no-store")
	}
	return a.w.Write(b)
}

// Integrity is the Audit log's seals and retention, as the screen shows them.
type Integrity struct {
	// Verification is the latest check, by the hourly upkeep or Verify; nil
	// until the first since the API started.
	Verification *audit.Verification `json:"verification"`
	SealedDays   int                 `json:"sealed_days"`
	FirstSealed  *time.Time          `json:"first_sealed"`
	LastSealed   *time.Time          `json:"last_sealed"`
	LastSealedAt *time.Time          `json:"last_sealed_at"`
	// RetentionDays is API_AUDIT_RETENTION in days.
	RetentionDays int           `json:"retention_days"`
	Purges        []audit.Purge `json:"purges"`
	// TSA is the timestamp service anchoring the seals (API_AUDIT_TSA_URL);
	// empty when they are not timestamped. StampedDays are the seals with a
	// timestamp, LastStamped the newest one's day and LastStampedAt its time.
	TSA           string     `json:"tsa"`
	StampedDays   int        `json:"stamped_days"`
	LastStamped   *time.Time `json:"last_stamped"`
	LastStampedAt *time.Time `json:"last_stamped_at"`
}

func auditIntegrity(r *http.Request, svc services) (Integrity, error) {
	seals, err := svc.audit.Seals(r.Context())
	if err != nil {
		return Integrity{}, err
	}
	purges, err := svc.audit.Purges(r.Context())
	if err != nil {
		return Integrity{}, err
	}
	if purges == nil {
		purges = make([]audit.Purge, 0)
	}
	in := Integrity{
		Verification: svc.audit.LastVerification(), SealedDays: len(seals),
		RetentionDays: int(svc.audit.Retention() / (24 * time.Hour)), Purges: purges,
	}
	if n := len(seals); n > 0 {
		first, last, at := seals[0].Day, seals[n-1].Day, seals[n-1].SealedAt
		in.FirstSealed, in.LastSealed, in.LastSealedAt = &first, &last, &at
	}
	if on, url := svc.audit.Timestamped(); on {
		stamps, err := svc.audit.Stamps(r.Context())
		if err != nil {
			return Integrity{}, err
		}
		in.TSA, in.StampedDays = url, len(stamps)
		if n := len(stamps); n > 0 {
			day, at := stamps[n-1].Day, stamps[n-1].StampedAt
			in.LastStamped, in.LastStampedAt = &day, &at
		}
	}
	return in, nil
}
