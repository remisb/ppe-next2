package main

import (
	"net/http"

	"github.com/remisb/ppe-next2/internal/domain/catalogue"
	"github.com/remisb/ppe-next2/internal/domain/size"
)

type catalogueHandler struct {
	items *catalogue.Service
}

// registerCatalogueRoutes mounts /api/v1/catalogue. Everyone reads; only
// admin and manager ("Manage Items and Prices") write.
func registerCatalogueRoutes(rt *router, items *catalogue.Service) {
	h := &catalogueHandler{items: items}
	rt.authenticated("GET /api/v1/catalogue", h.list)
	// The literal /active outranks the /{id} wildcard in ServeMux.
	rt.authenticated("GET /api/v1/catalogue/active", h.listActive)
	rt.authenticated("GET /api/v1/catalogue/{id}", h.get)
	rt.authenticated("GET /api/v1/catalogue/{id}/price-history", h.priceHistory)
	rt.restricted("POST /api/v1/catalogue", h.create, managers...)
	rt.restricted("PUT /api/v1/catalogue/{id}", h.update, managers...)
	rt.restricted("POST /api/v1/catalogue/{id}/activate", h.activate, managers...)
	rt.restricted("POST /api/v1/catalogue/{id}/deactivate", h.deactivate, managers...)
	rt.restricted("DELETE /api/v1/catalogue/{id}", h.delete, managers...)
}

type catalogueRequest struct {
	Name                string     `json:"name"`
	Details             string     `json:"details"`
	SizeGroup           size.Group `json:"size_group"`
	UnitPriceCents      *int64     `json:"unit_price_cents"`
	ServicePeriodMonths *int       `json:"service_period_months"`
	Active              *bool      `json:"active"`
	DisplayRank         *int       `json:"display_rank"`
}

func (req catalogueRequest) params() (catalogue.Params, error) {
	active, err := requireBool(req.Active, "active", catalogue.ErrInvalid)
	if err != nil {
		return catalogue.Params{}, err
	}
	return catalogue.Params{
		Name: req.Name, Details: req.Details, SizeGroup: req.SizeGroup, UnitPriceCents: req.UnitPriceCents,
		ServicePeriodMonths: req.ServicePeriodMonths, Active: active, DisplayRank: req.DisplayRank,
	}, nil
}

func (h *catalogueHandler) list(w http.ResponseWriter, r *http.Request) {
	items, err := h.items.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *catalogueHandler) listActive(w http.ResponseWriter, r *http.Request) {
	items, err := h.items.ListActive(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *catalogueHandler) get(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	item, err := h.items.Get(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// priceHistory lists the item's price and service period changes, newest
// first, ending with the values it was created with.
func (h *catalogueHandler) priceHistory(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	history, err := h.items.PriceHistory(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, history)
}

func (h *catalogueHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req catalogueRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	p, err := req.params()
	if err != nil {
		writeError(w, r, err)
		return
	}
	item, err := h.items.Create(r.Context(), p, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/catalogue/"+item.ID.String())
	writeJSON(w, http.StatusCreated, item)
}

func (h *catalogueHandler) update(w http.ResponseWriter, r *http.Request) {
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
	var req catalogueRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	p, err := req.params()
	if err != nil {
		writeError(w, r, err)
		return
	}
	item, err := h.items.Update(r.Context(), id, p, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h *catalogueHandler) activate(w http.ResponseWriter, r *http.Request) { h.setActive(w, r, true) }
func (h *catalogueHandler) deactivate(w http.ResponseWriter, r *http.Request) {
	h.setActive(w, r, false)
}

func (h *catalogueHandler) setActive(w http.ResponseWriter, r *http.Request, active bool) {
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
	item, err := h.items.SetActive(r.Context(), id, active, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h *catalogueHandler) delete(w http.ResponseWriter, r *http.Request) {
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
	if err := h.items.Delete(r.Context(), id, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
