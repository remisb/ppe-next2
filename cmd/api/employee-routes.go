package main

import (
	"net/http"

	"github.com/remisb/ppe-next2/internal/domain/employee"
)

type employeeHandler struct {
	employees *employee.Service
}

// registerEmployeeRoutes mounts /api/v1/employees. Staff who prepare orders
// (every role) maintain employees and their sizes; deleting needs a manager.
func registerEmployeeRoutes(rt *router, employees *employee.Service) {
	h := &employeeHandler{employees: employees}
	rt.authenticated("GET /api/v1/employees", h.list)
	rt.authenticated("GET /api/v1/employees/{id}", h.get)
	rt.authenticated("GET /api/v1/employees/by-name/{q}", h.search)
	rt.authenticated("POST /api/v1/employees", h.create)
	rt.authenticated("PUT /api/v1/employees/{id}", h.update)
	rt.authenticated("PUT /api/v1/employees/{id}/sizes", h.updateSizes)
	rt.restricted("DELETE /api/v1/employees/{id}", h.delete, managers...)
}

// employeeJSON adds derived fields to the response; they are never accepted.
type employeeJSON struct {
	employee.Employee
	FullName string `json:"full_name"`
}

func toEmployeeJSON(e employee.Employee) employeeJSON {
	return employeeJSON{Employee: e, FullName: e.FullName()}
}

func toEmployeesJSON(es []employee.Employee) []employeeJSON {
	out := make([]employeeJSON, len(es))
	for i, e := range es {
		out[i] = toEmployeeJSON(e)
	}
	return out
}

type employeeRequest struct {
	FirstName    string  `json:"first_name"`
	LastName     string  `json:"last_name"`
	Code         *string `json:"code"`
	HeightCm     *int    `json:"height_cm"`
	ClothingSize *string `json:"clothing_size"`
	ShoeSize     *string `json:"shoe_size"`
	Notes        string  `json:"notes"`
}

func (req employeeRequest) params() employee.Params {
	return employee.Params{
		FirstName: req.FirstName, LastName: req.LastName, Code: req.Code, HeightCm: req.HeightCm,
		ClothingSize: req.ClothingSize, ShoeSize: req.ShoeSize, Notes: req.Notes,
	}
}

type employeeSizesRequest struct {
	HeightCm     *int    `json:"height_cm"`
	ClothingSize *string `json:"clothing_size"`
	ShoeSize     *string `json:"shoe_size"`
}

func (h *employeeHandler) list(w http.ResponseWriter, r *http.Request) {
	es, err := h.employees.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toEmployeesJSON(es))
}

func (h *employeeHandler) get(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	e, err := h.employees.Get(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toEmployeeJSON(e))
}

// search is a filter for the Assigned to selector: no match is 200 [].
func (h *employeeHandler) search(w http.ResponseWriter, r *http.Request) {
	es, err := h.employees.Search(r.Context(), r.PathValue("q"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toEmployeesJSON(es))
}

func (h *employeeHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req employeeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	e, err := h.employees.Create(r.Context(), req.params(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/employees/"+e.ID.String())
	writeJSON(w, http.StatusCreated, toEmployeeJSON(e))
}

func (h *employeeHandler) update(w http.ResponseWriter, r *http.Request) {
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
	var req employeeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	e, err := h.employees.Update(r.Context(), id, req.params(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toEmployeeJSON(e))
}

// updateSizes is Edit Sizes and Save as Employee Default. It replaces all three
// size defaults; send the current values for any that should stay.
func (h *employeeHandler) updateSizes(w http.ResponseWriter, r *http.Request) {
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
	var req employeeSizesRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	e, err := h.employees.UpdateSizes(r.Context(), id, employee.SizesParams{
		HeightCm: req.HeightCm, ClothingSize: req.ClothingSize, ShoeSize: req.ShoeSize,
	}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toEmployeeJSON(e))
}

func (h *employeeHandler) delete(w http.ResponseWriter, r *http.Request) {
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
	if err := h.employees.Delete(r.Context(), id, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
