package main

import (
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/security"
)

// securityParams are the only query parameters the security log accepts; as
// the Audit log's, they combine freely, so they are query parameters.
var securityParams = map[string]bool{
	"kind": true, "user": true, "from": true, "to": true, "after": true, "page_size": true,
}

// registerSecurityRoutes mounts Administration's Security screen
// (docs/specs/security-service.md): the security log, every user's live
// sessions and the access review, under security.read. Ending someone's
// session is managing that user, so it takes users.manage, a recent sign-in,
// and the right to manage them (user.Service.MayManage). Mark as reviewed
// changes no access, only records that a review happened, so security.read
// is enough.
func registerSecurityRoutes(rt *router, svc services, sensitive func(role.Permission, http.HandlerFunc) http.HandlerFunc) {
	rt.restricted("GET /api/v1/security/events", func(w http.ResponseWriter, r *http.Request) {
		f, err := securityFilter(r)
		if err != nil {
			writeError(w, r, err)
			return
		}
		page, err := svc.security.List(r.Context(), f)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, page)
	}, role.SecurityRead)

	rt.restricted("GET /api/v1/security/sessions", func(w http.ResponseWriter, r *http.Request) {
		list, err := svc.security.Sessions(r.Context())
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}, role.SecurityRead)

	rt.restricted("DELETE /api/v1/security/sessions/{id}", sensitive(role.UsersManage, func(w http.ResponseWriter, r *http.Request) {
		actor, err := actorID(r)
		if err != nil {
			writeError(w, r, err)
			return
		}
		id, err := parseUUIDPath(r, "id")
		if err != nil {
			writeError(w, r, err)
			return
		}
		s, err := svc.sessions.Live(r.Context(), id)
		if err == nil {
			err = svc.users.MayManage(r.Context(), s.UserID, actor)
		}
		if err == nil {
			err = svc.sessions.EndByAdministrator(r.Context(), s.UserID, id)
		}
		if err != nil {
			writeError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}), role.UsersManage)

	rt.restricted("GET /api/v1/security/access-review", func(w http.ResponseWriter, r *http.Request) {
		review, err := svc.security.Review(r.Context())
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, review)
	}, role.SecurityRead)

	rt.restricted("POST /api/v1/security/access-review", func(w http.ResponseWriter, r *http.Request) {
		actor, err := actorID(r)
		if err != nil {
			writeError(w, r, err)
			return
		}
		review, err := svc.security.MarkReviewed(r.Context(), actor)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, review)
	}, role.SecurityRead)
}

// securityFilter reads the security log's query parameters; the service
// checks their values.
//
//	GET /api/v1/security/events?kind=&user=<user id>&from=YYYY-MM-DD&to=YYYY-MM-DD
//	    &after=<next>&page_size=
func securityFilter(r *http.Request) (security.Filter, error) {
	q := r.URL.Query()
	for k, v := range q {
		if !securityParams[k] || len(v) > 1 {
			return security.Filter{}, errBadRequest
		}
	}
	f := security.Filter{Kind: security.Kind(q.Get("kind")), FromDate: q.Get("from"), ToDate: q.Get("to")}
	if v := q.Get("user"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			return security.Filter{}, errBadRequest
		}
		f.UserID = &id
	}
	if v := q.Get("after"); v != "" {
		c, err := audit.ParseCursor(v)
		if err != nil {
			return security.Filter{}, err
		}
		f.After = &c
	}
	if v := q.Get("page_size"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return security.Filter{}, errBadRequest
		}
		f.PageSize = n
	}
	return f, nil
}
