package main

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/domain/order"
)

type confirmationHandler struct {
	orders  *order.Service
	baseURL string
}

// registerConfirmationRoutes mounts Employee Confirmation and the Items Given
// Record. Staff routes need a token; the two public routes are authorised by
// the confirmation link alone. The link token travels in the request body, not
// the path, so the request logger never records it.
func registerConfirmationRoutes(rt *router, orders *order.Service, baseURL string, client clientAddr) {
	h := &confirmationHandler{orders: orders, baseURL: baseURL}
	rt.authenticated("POST /api/v1/orders/{id}/confirmation-link", h.createLink)
	rt.authenticated("POST /api/v1/orders/{id}/confirm-paper", h.confirmPaper)
	rt.authenticated("GET /api/v1/orders/{id}/record", h.record)

	limit := middleware.RateLimiter(middleware.RateLimitConfig{RequestsPerInterval: 20, Interval: time.Minute, KeyFunc: client.key})
	rt.public("POST /api/v1/confirmations/view", middleware.Chain(http.HandlerFunc(h.publicView), limit))
	rt.public("POST /api/v1/confirmations/confirm", middleware.Chain(http.HandlerFunc(h.publicConfirm), limit))
}

type confirmationJSON struct {
	Method        order.Method `json:"method"`
	ConfirmedAt   *time.Time   `json:"confirmed_at"`
	ConfirmedName *string      `json:"confirmed_name"`
}

// recordJSON is the Items Given Record: the locked receipt plus status and,
// once GIVEN, the confirmation evidence. OrderID is omitted on public routes.
type recordJSON struct {
	OrderID            *uuid.UUID        `json:"order_id,omitempty"`
	Receipt            order.Receipt     `json:"receipt"`
	DocumentHash       string            `json:"document_hash"`
	Status             order.Status      `json:"status"`
	GivenAt            *time.Time        `json:"given_at"`
	GivenByName        *string           `json:"given_by_name"`
	ConfirmationMethod *order.Method     `json:"confirmation_method"`
	Confirmation       *confirmationJSON `json:"confirmation"`
}

func toRecordJSON(r order.Record, withID bool) recordJSON {
	out := recordJSON{
		Receipt: r.Receipt, DocumentHash: r.DocumentHash, Status: r.Order.Status, GivenAt: r.Order.GivenAt,
		GivenByName: r.Order.GivenByName, ConfirmationMethod: r.Order.ConfirmationMethod,
	}
	if withID {
		id := r.Order.ID
		out.OrderID = &id
	}
	if c := r.Confirmation; c != nil {
		out.Confirmation = &confirmationJSON{Method: c.Method, ConfirmedAt: c.ConfirmedAt, ConfirmedName: c.ConfirmedName}
	}
	return out
}

// createLink is Open Employee Confirmation. The link is shown once; only its
// hash is stored, and it replaces any earlier unused link.
func (h *confirmationHandler) createLink(w http.ResponseWriter, r *http.Request) {
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
	token, expires, err := h.orders.CreateConfirmationLink(r.Context(), id, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{"url": h.baseURL + "/confirm/" + token, "expires_at": expires})
}

// confirmPaper records a signed paper Items Given Record.
func (h *confirmationHandler) confirmPaper(w http.ResponseWriter, r *http.Request) {
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
	rec, err := h.orders.ConfirmPaper(r.Context(), id, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toRecordJSON(rec, true))
}

func (h *confirmationHandler) record(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	rec, err := h.orders.Record(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toRecordJSON(rec, true))
}

type tokenRequest struct {
	Token     string `json:"token"`
	Confirmed bool   `json:"confirmed"`
}

func (h *confirmationHandler) publicView(w http.ResponseWriter, r *http.Request) {
	var req tokenRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	rec, err := h.orders.RecordByToken(r.Context(), req.Token)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, toRecordJSON(rec, false))
}

// publicConfirm is Confirm Receipt / Подтвердить. Repeating it returns the
// existing GIVEN record.
func (h *confirmationHandler) publicConfirm(w http.ResponseWriter, r *http.Request) {
	var req tokenRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	rec, err := h.orders.ConfirmByToken(r.Context(), req.Token, req.Confirmed)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, toRecordJSON(rec, false))
}
