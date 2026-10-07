package main

import (
	"context"
	"net/http"
	"strconv"

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
