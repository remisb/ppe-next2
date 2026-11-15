package main

import (
	"net/http"

	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/supplier"
)

type supplierHandler struct {
	suppliers *supplier.Service
}

// registerSupplierRoutes mounts /api/v1/suppliers. Everyone reads (Edit Item
// offers them); only suppliers.manage ("Manage Suppliers", Administration's
// Suppliers) writes.
func registerSupplierRoutes(rt *router, svc *supplier.Service) {
	h := &supplierHandler{suppliers: svc}
	rt.authenticated("GET /api/v1/suppliers", h.list)
	rt.authenticated("GET /api/v1/suppliers/{id}", h.get)
	rt.restricted("POST /api/v1/suppliers", h.create, role.SuppliersManage)
	rt.restricted("PUT /api/v1/suppliers/{id}", h.update, role.SuppliersManage)
	rt.restricted("DELETE /api/v1/suppliers/{id}", h.delete, role.SuppliersManage)
}

// supplierRequest is a supplier's every client-settable field; Update
// replaces them all.
type supplierRequest struct {
	Code          string `json:"code"`
	Name          string `json:"name"`
	CompanyCode   string `json:"company_code"`
	VATCode       string `json:"vat_code"`
	Address       string `json:"address"`
	City          string `json:"city"`
	PostalCode    string `json:"postal_code"`
	Country       string `json:"country"`
	ContactPerson string `json:"contact_person"`
	Email         string `json:"email"`
	Phone         string `json:"phone"`
	Website       string `json:"website"`
	BankAccount   string `json:"bank_account"`
	Notes         string `json:"notes"`
}

func (req supplierRequest) params() supplier.Params {
	return supplier.Params{
		Code: req.Code, Name: req.Name, CompanyCode: req.CompanyCode, VATCode: req.VATCode,
		Address: req.Address, City: req.City, PostalCode: req.PostalCode, Country: req.Country,
		ContactPerson: req.ContactPerson, Email: req.Email, Phone: req.Phone, Website: req.Website,
		BankAccount: req.BankAccount, Notes: req.Notes,
	}
}

func (h *supplierHandler) list(w http.ResponseWriter, r *http.Request) {
	list, err := h.suppliers.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (h *supplierHandler) get(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	s, err := h.suppliers.Get(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

func (h *supplierHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req supplierRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	s, err := h.suppliers.Create(r.Context(), req.params(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/suppliers/"+s.ID.String())
	writeJSON(w, http.StatusCreated, s)
}

func (h *supplierHandler) update(w http.ResponseWriter, r *http.Request) {
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
	var req supplierRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	s, err := h.suppliers.Update(r.Context(), id, req.params(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// delete soft-deletes the supplier; its items read as having none.
func (h *supplierHandler) delete(w http.ResponseWriter, r *http.Request) {
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
	if err := h.suppliers.Delete(r.Context(), id, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
