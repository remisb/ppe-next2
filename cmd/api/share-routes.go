package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/share"
)

// Shared links (WARE-51, docs/specs/share-service.md): Share Link on the
// Employees export sheet keeps up to ten employees' rows, as the sharer sees
// them, behind a link anyone may open until it expires or is revoked on
// Shared Links. The rows are shaped here, as every employee answer is
// (toEmployeeJSON); the link's rules are the share domain's. The token
// travels in request bodies, never a path, so no log line holds it.
type shareHandler struct {
	shares    *share.Service
	employees *employee.Service
	baseURL   string
}

func registerShareRoutes(rt *router, shares *share.Service, employees *employee.Service, baseURL string) {
	h := &shareHandler{shares: shares, employees: employees, baseURL: baseURL}
	rt.authenticated("POST /api/v1/shares", h.create)
	rt.authenticated("GET /api/v1/shares", h.list)
	rt.authenticated("DELETE /api/v1/shares/{id}", h.revoke)

	limit := middleware.RateLimiter(middleware.RateLimitConfig{RequestsPerInterval: 20, Interval: time.Minute, KeyFunc: middleware.ClientAddr})
	rt.public("POST /api/v1/shares/view", middleware.Chain(http.HandlerFunc(h.view), limit))
}

// employeeShareFields are, for each column Employees' export offers
// (web/apps/workwear/src/lib/employee-export.ts), the fields of an employee's
// answer its value is read from. A shared row holds these alone.
var employeeShareFields = map[string][]string{
	"name":        {"full_name"},
	"first_name":  {"first_name"},
	"last_name":   {"last_name"},
	"status":      {"status"},
	"company":     {"company"},
	"code":        {"code"},
	"height":      {"height_cm"},
	"clothing":    {"clothing_size"},
	"shoes":       {"shoe_size"},
	"language":    {"preferred_language"},
	"notes":       {"notes"},
	"birth_date":  {"birth_date"},
	"nationality": {"nationality"},
	"sex":         {"sex"},
	"added":       {"created_at"},
}

// employeeShareRows are the employees ids, in that order, as the request's
// user may see them (employee.Sight), each with the chosen columns' fields
// alone. An unknown column is share.ErrInvalid; an employee not there,
// employee.ErrNotFound.
func (h *shareHandler) employeeShareRows(r *http.Request, ids []uuid.UUID, columns []string) ([]json.RawMessage, error) {
	for _, c := range columns {
		if _, ok := employeeShareFields[c]; !ok {
			return nil, fmt.Errorf("%w: columns: %q is not a column of Employees", share.ErrInvalid, c)
		}
	}
	rows := make([]json.RawMessage, 0, len(ids))
	for _, id := range ids {
		e, err := h.employees.Get(r.Context(), id)
		if err != nil {
			return nil, err
		}
		b, err := json.Marshal(toEmployeeJSON(r, e))
		if err != nil {
			return nil, err
		}
		var all map[string]json.RawMessage
		if err := json.Unmarshal(b, &all); err != nil {
			return nil, err
		}
		picked := map[string]json.RawMessage{}
		for _, c := range columns {
			for _, f := range employeeShareFields[c] {
				if v, ok := all[f]; ok {
					picked[f] = v
				}
			}
		}
		row, err := json.Marshal(picked)
		if err != nil {
			return nil, err
		}
		rows = append(rows, row)
	}
	return rows, nil
}

type shareRequest struct {
	Kind    share.Kind  `json:"kind"`
	Name    string      `json:"name"`
	Columns []string    `json:"columns"`
	IDs     []uuid.UUID `json:"ids"`
	Days    int         `json:"days"`
}

// create is Share Link. The link is answered once: only its hash is kept.
func (h *shareHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, ok := actorOf(w, r)
	if !ok {
		return
	}
	var req shareRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if req.Kind != share.KindEmployees {
		writeError(w, r, fmt.Errorf("%w: kind: only employees can be shared", share.ErrInvalid))
		return
	}
	// The count first, so a request for many records reads none.
	if err := share.CheckRows(len(req.IDs)); err != nil {
		writeError(w, r, err)
		return
	}
	rows, err := h.employeeShareRows(r, req.IDs, req.Columns)
	if err != nil {
		writeError(w, r, err)
		return
	}
	sh, token, err := h.shares.Create(r.Context(), share.CreateParams{
		Kind: req.Kind, Name: req.Name, Columns: req.Columns, SubjectIDs: req.IDs, Rows: rows, Days: req.Days,
	}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{"share": sh, "url": h.baseURL + "/shared/" + token})
}

// list is Shared Links: the reader's links still open.
func (h *shareHandler) list(w http.ResponseWriter, r *http.Request) {
	actor, ok := actorOf(w, r)
	if !ok {
		return
	}
	out, err := h.shares.List(r.Context(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// revoke is Revoke on Shared Links: the sharer's own open link.
func (h *shareHandler) revoke(w http.ResponseWriter, r *http.Request) {
	id, actor, ok := idAndActor(w, r)
	if !ok {
		return
	}
	if err := h.shares.Revoke(r.Context(), id, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// sharedViewJSON is the public page's: what was shared, by whom and until
// when; never the records' ids or the sharer's.
type sharedViewJSON struct {
	Kind      share.Kind        `json:"kind"`
	Name      string            `json:"name"`
	Columns   []string          `json:"columns"`
	Rows      []json.RawMessage `json:"rows"`
	SharedBy  string            `json:"shared_by"`
	CreatedAt time.Time         `json:"created_at"`
	ExpiresAt time.Time         `json:"expires_at"`
}

// view is the public page's read, by the token in the body: 404 for an
// unknown link, 410 for one revoked or expired.
func (h *shareHandler) view(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	sh, err := h.shares.Open(r.Context(), req.Token)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, sharedViewJSON{
		Kind: sh.Kind, Name: sh.Name, Columns: sh.Columns, Rows: sh.Rows,
		SharedBy: sh.CreatedByName, CreatedAt: sh.CreatedAt, ExpiresAt: sh.ExpiresAt,
	})
}
