package main

import (
	"net/http"

	"github.com/remisb/ppe-next2/internal/domain/company"
	"github.com/remisb/ppe-next2/internal/domain/role"
)

type companyHandler struct {
	companies *company.Service
}

// registerCompanyRoutes mounts /api/v1/companies. Everyone reads (Add New
// Employee and Employ offer them); only companies.manage ("Manage Companies",
// Administration's Companies) writes.
func registerCompanyRoutes(rt *router, svc *company.Service) {
	h := &companyHandler{companies: svc}
	rt.authenticated("GET /api/v1/companies", h.list)
	rt.authenticated("GET /api/v1/companies/{id}", h.get)
	rt.restricted("POST /api/v1/companies", h.create, role.CompaniesManage)
	rt.restricted("PUT /api/v1/companies/{id}", h.update, role.CompaniesManage)
	rt.restricted("PUT /api/v1/companies/{id}/default", h.makeDefault, role.CompaniesManage)
	rt.restricted("DELETE /api/v1/companies/{id}", h.delete, role.CompaniesManage)
}

// companyRequest is a company's every client-settable field; Update replaces
// them all. Which is the default is PUT …/default's.
type companyRequest struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	CompanyCode string `json:"company_code"`
	VATCode     string `json:"vat_code"`
	Address     string `json:"address"`
	City        string `json:"city"`
	PostalCode  string `json:"postal_code"`
	Country     string `json:"country"`
	Notes       string `json:"notes"`
}

func (req companyRequest) params() company.Params {
	return company.Params{
		Code: req.Code, Name: req.Name, CompanyCode: req.CompanyCode, VATCode: req.VATCode,
		Address: req.Address, City: req.City, PostalCode: req.PostalCode, Country: req.Country, Notes: req.Notes,
	}
}

func (h *companyHandler) list(w http.ResponseWriter, r *http.Request) {
	list, err := h.companies.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (h *companyHandler) get(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	c, err := h.companies.Get(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (h *companyHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req companyRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	c, err := h.companies.Create(r.Context(), req.params(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/companies/"+c.ID.String())
	writeJSON(w, http.StatusCreated, c)
}

func (h *companyHandler) update(w http.ResponseWriter, r *http.Request) {
	id, actor, ok := idAndActor(w, r)
	if !ok {
		return
	}
	var req companyRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	c, err := h.companies.Update(r.Context(), id, req.params(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// makeDefault is Make Default: the company becomes the default, the previous
// one stops being it.
func (h *companyHandler) makeDefault(w http.ResponseWriter, r *http.Request) {
	id, actor, ok := idAndActor(w, r)
	if !ok {
		return
	}
	c, err := h.companies.MakeDefault(r.Context(), id, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// delete soft-deletes the company; the default and one employing anyone are refused.
func (h *companyHandler) delete(w http.ResponseWriter, r *http.Request) {
	id, actor, ok := idAndActor(w, r)
	if !ok {
		return
	}
	if err := h.companies.Delete(r.Context(), id, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
