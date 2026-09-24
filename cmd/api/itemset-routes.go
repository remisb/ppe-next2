package main

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/itemset"
)

type itemSetHandler struct {
	sets *itemset.Service
}

// registerItemSetRoutes mounts /api/v1/item-sets. Everyone reads; admin and
// manager maintain sets. Applying a set to an employee is in order-routes.go.
func registerItemSetRoutes(rt *router, sets *itemset.Service) {
	h := &itemSetHandler{sets: sets}
	rt.authenticated("GET /api/v1/item-sets", h.list)
	rt.authenticated("GET /api/v1/item-sets/active", h.listActive)
	rt.authenticated("GET /api/v1/item-sets/{id}", h.get)
	rt.restricted("POST /api/v1/item-sets", h.create, managers...)
	rt.restricted("PUT /api/v1/item-sets/{id}", h.update, managers...)
	rt.restricted("DELETE /api/v1/item-sets/{id}", h.delete, managers...)
}

type itemSetLineRequest struct {
	CatalogueItemID uuid.UUID `json:"catalogue_item_id"`
	DefaultQuantity int       `json:"default_quantity"`
}

// itemSetRequest: lines are in display order; their position is the order.
type itemSetRequest struct {
	Name        string               `json:"name"`
	Description string               `json:"description"`
	Active      *bool                `json:"active"`
	Lines       []itemSetLineRequest `json:"lines"`
}

func (req itemSetRequest) params() (itemset.Params, error) {
	active, err := requireBool(req.Active, "active", itemset.ErrInvalid)
	if err != nil {
		return itemset.Params{}, err
	}
	lines := make([]itemset.LineParams, len(req.Lines))
	for i, l := range req.Lines {
		lines[i] = itemset.LineParams{CatalogueItemID: l.CatalogueItemID, DefaultQuantity: l.DefaultQuantity}
	}
	return itemset.Params{Name: req.Name, Description: req.Description, Active: active, Lines: lines}, nil
}

func (h *itemSetHandler) list(w http.ResponseWriter, r *http.Request) {
	sets, err := h.sets.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, sets)
}

func (h *itemSetHandler) listActive(w http.ResponseWriter, r *http.Request) {
	sets, err := h.sets.ListActive(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, sets)
}

func (h *itemSetHandler) get(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	s, err := h.sets.Get(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

func (h *itemSetHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req itemSetRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	p, err := req.params()
	if err != nil {
		writeError(w, r, err)
		return
	}
	s, err := h.sets.Create(r.Context(), p, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/item-sets/"+s.ID.String())
	writeJSON(w, http.StatusCreated, s)
}

func (h *itemSetHandler) update(w http.ResponseWriter, r *http.Request) {
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
	var req itemSetRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	p, err := req.params()
	if err != nil {
		writeError(w, r, err)
		return
	}
	s, err := h.sets.Update(r.Context(), id, p, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

func (h *itemSetHandler) delete(w http.ResponseWriter, r *http.Request) {
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
	if err := h.sets.Delete(r.Context(), id, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
