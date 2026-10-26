package main

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/catalogue"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/size"
)

type catalogueHandler struct {
	items *catalogue.Service
}

// registerCatalogueRoutes mounts /api/v1/catalogue. Everyone reads; only
// catalogue.manage ("Manage Item Catalogue") writes, items and pictures, and
// setting or changing an item's prices also needs item_prices.manage
// ("Change Item prices"; rights).
func registerCatalogueRoutes(rt *router, items *catalogue.Service) {
	h := &catalogueHandler{items: items}
	rt.authenticated("GET /api/v1/catalogue", h.list)
	// The literals /active and /pictures outrank the /{id} wildcard in ServeMux.
	rt.authenticated("GET /api/v1/catalogue/active", h.listActive)
	rt.authenticated("GET /api/v1/catalogue/pictures", h.pictures)
	rt.restricted("PUT /api/v1/catalogue/pictures/{icon}", h.updatePicture, role.CatalogueManage)
	rt.authenticated("GET /api/v1/catalogue/{id}", h.get)
	rt.authenticated("GET /api/v1/catalogue/{id}/price-history", h.priceHistory)
	rt.restricted("POST /api/v1/catalogue", h.create, role.CatalogueManage)
	rt.restricted("PUT /api/v1/catalogue/{id}", h.update, role.CatalogueManage)
	rt.restricted("POST /api/v1/catalogue/{id}/activate", h.activate, role.CatalogueManage)
	rt.restricted("POST /api/v1/catalogue/{id}/deactivate", h.deactivate, role.CatalogueManage)
	rt.restricted("DELETE /api/v1/catalogue/{id}", h.delete, role.CatalogueManage)
	rt.restricted("POST /api/v1/catalogue/{id}/move", h.move, role.CatalogueManage)
}

// catalogueRequest has no size_group: an item's is its picture's, so a body
// that sends one is refused as an unknown field.
type catalogueRequest struct {
	Name                 string `json:"name"`
	Details              string `json:"details"`
	PurchasePriceCents   *int64 `json:"purchase_price_cents"`
	AccountingPriceCents *int64 `json:"accounting_price_cents"`
	ServicePeriodMonths  *int   `json:"service_period_months"`
	Active               *bool  `json:"active"`
	DisplayRank          *int   `json:"display_rank"`
	// Icon is the picture, optional: omitted is "other".
	Icon catalogue.Icon `json:"icon"`
}

// moveRequest puts the item in front of before_id in the display order, or
// last when before_id is null or left out.
type moveRequest struct {
	BeforeID *uuid.UUID `json:"before_id"`
}

type pictureRequest struct {
	SizeGroup size.Group `json:"size_group"`
}

func (req catalogueRequest) params() (catalogue.Params, error) {
	active, err := requireBool(req.Active, "active", catalogue.ErrInvalid)
	if err != nil {
		return catalogue.Params{}, err
	}
	return catalogue.Params{
		Name: req.Name, Details: req.Details,
		PurchasePriceCents: req.PurchasePriceCents, AccountingPriceCents: req.AccountingPriceCents,
		ServicePeriodMonths: req.ServicePeriodMonths, Active: active, DisplayRank: req.DisplayRank, Icon: req.Icon,
	}, nil
}

// rights is what the request's user may change on an item beyond what
// catalogue.manage allows: its prices only with item_prices.manage.
func rights(r *http.Request) catalogue.Rights {
	return catalogue.Rights{Prices: holds(r, role.ItemPricesManage)}
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

func (h *catalogueHandler) pictures(w http.ResponseWriter, r *http.Request) {
	pics, err := h.items.Pictures(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, pics)
}

// updatePicture sets a picture's size group, and so its items'.
func (h *catalogueHandler) updatePicture(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req pictureRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	pic, err := h.items.UpdatePicture(r.Context(), catalogue.Icon(r.PathValue("icon")), catalogue.PictureParams{SizeGroup: req.SizeGroup}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, pic)
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
	item, err := h.items.Create(r.Context(), p, rights(r), actor)
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
	item, err := h.items.Update(r.Context(), id, p, rights(r), actor)
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

// move changes the item's place in the display order and answers every live
// item in the new order.
func (h *catalogueHandler) move(w http.ResponseWriter, r *http.Request) {
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
	var req moveRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	items, err := h.items.Move(r.Context(), id, req.BeforeID, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
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
