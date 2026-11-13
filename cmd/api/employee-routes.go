package main

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/role"
)

type employeeHandler struct {
	employees *employee.Service
}

// registerEmployeeRoutes mounts /api/v1/employees. Any signed-in user reads
// employees' names (Create Order, Orders and search need them); their sizes
// need employee_sizes.read and the rest of the profile employee_profiles.read
// (employee.Sight, blank otherwise). Adding and editing employees needs
// employee_profiles.manage, and the size defaults employee_sizes.manage
// (employee.Rights: Edit keeps them without it); deleting needs
// employees.delete, and merging two records of one person employees.merge.
func registerEmployeeRoutes(rt *router, employees *employee.Service) {
	h := &employeeHandler{employees: employees}
	rt.authenticated("GET /api/v1/employees", h.list)
	rt.authenticated("GET /api/v1/employees/{id}", h.get)
	rt.authenticated("GET /api/v1/employees/by-name/{q}", h.search)
	rt.restricted("POST /api/v1/employees", h.create, role.EmployeeProfilesManage)
	rt.restricted("PUT /api/v1/employees/{id}", h.update, role.EmployeeProfilesManage)
	rt.restricted("PUT /api/v1/employees/{id}/sizes", h.updateSizes, role.EmployeeSizesManage)
	rt.restricted("DELETE /api/v1/employees/{id}", h.delete, role.EmployeesDelete)
	// Duplicates and merging (docs/specs/employee-service.md): Add New Employee
	// asks for alike names first; the Employees screen offers the pairs, Not
	// the Same Person and Merge Employees.
	rt.restricted("POST /api/v1/employees/similar", h.similar, role.EmployeeProfilesManage)
	rt.restricted("GET /api/v1/employees/possible-duplicates", h.possibleDuplicates, role.EmployeesMerge)
	rt.restricted("POST /api/v1/employees/distinct-pairs", h.markDistinct, role.EmployeesMerge)
	rt.restricted("GET /api/v1/employees/{id}/merge/{remove}", h.mergePreview, role.EmployeesMerge)
	rt.restricted("POST /api/v1/employees/{id}/merge/{remove}", h.merge, role.EmployeesMerge)
}

// employeeSight is which of an employee's data the request's user may see.
func employeeSight(r *http.Request) employee.Sight {
	return employee.Sight{Sizes: holds(r, role.EmployeeSizesRead), Profile: holds(r, role.EmployeeProfilesRead)}
}

// employeeRights is which of an employee's data the request's user may change.
func employeeRights(r *http.Request) employee.Rights {
	return employee.Rights{Sizes: holds(r, role.EmployeeSizesManage), Profile: holds(r, role.EmployeeProfilesManage)}
}

// employeeJSON adds derived fields to the response; they are never accepted.
type employeeJSON struct {
	employee.Employee
	FullName string `json:"full_name"`
}

// toEmployeeJSON is e as the request's user may see it.
func toEmployeeJSON(r *http.Request, e employee.Employee) employeeJSON {
	return employeeJSON{Employee: employeeSight(r).Show(e), FullName: e.FullName()}
}

func toEmployeesJSON(r *http.Request, es []employee.Employee) []employeeJSON {
	out := make([]employeeJSON, len(es))
	for i, e := range es {
		out[i] = toEmployeeJSON(r, e)
	}
	return out
}

type employeeRequest struct {
	FirstName    string  `json:"first_name"`
	LastName     string  `json:"last_name"`
	Code         *string `json:"code"`
	HeightCm     *int    `json:"height_cm"`
	ClothingSize *int    `json:"clothing_size"`
	ShoeSize     *string `json:"shoe_size"`
	Notes        string  `json:"notes"`
	// Optional; en, lt or ru. Update replaces every field, so leaving it out clears it.
	PreferredLanguage *string `json:"preferred_language"`
}

func (req employeeRequest) params() employee.Params {
	return employee.Params{
		FirstName: req.FirstName, LastName: req.LastName, Code: req.Code, HeightCm: req.HeightCm,
		ClothingSize: req.ClothingSize, ShoeSize: req.ShoeSize, Notes: req.Notes,
		PreferredLanguage: req.PreferredLanguage,
	}
}

type employeeSizesRequest struct {
	HeightCm     *int    `json:"height_cm"`
	ClothingSize *int    `json:"clothing_size"`
	ShoeSize     *string `json:"shoe_size"`
}

func (h *employeeHandler) list(w http.ResponseWriter, r *http.Request) {
	es, err := h.employees.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toEmployeesJSON(r, es))
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
	writeJSON(w, http.StatusOK, toEmployeeJSON(r, e))
}

// search is the employee search (the employee picker, ⌘K, Import Documents'
// person step): no match is 200 [].
func (h *employeeHandler) search(w http.ResponseWriter, r *http.Request) {
	es, err := h.employees.Search(r.Context(), r.PathValue("q"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toEmployeesJSON(r, es))
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
	e, err := h.employees.Create(r.Context(), req.params(), employeeRights(r), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/employees/"+e.ID.String())
	writeJSON(w, http.StatusCreated, toEmployeeJSON(r, e))
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
	e, err := h.employees.Update(r.Context(), id, req.params(), employeeRights(r), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toEmployeeJSON(r, e))
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
	writeJSON(w, http.StatusOK, toEmployeeJSON(r, e))
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

type similarRequest struct {
	FirstName string     `json:"first_name"`
	LastName  string     `json:"last_name"`
	ExceptID  *uuid.UUID `json:"except_id"`
}

type matchJSON struct {
	Employee employeeJSON       `json:"employee"`
	Kind     employee.MatchKind `json:"kind"`
}

// similar is Add New Employee's check: live employees whose names are alike.
// The names go in the body, never the address, so they stay out of logs.
func (h *employeeHandler) similar(w http.ResponseWriter, r *http.Request) {
	var req similarRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	except := uuid.Nil
	if req.ExceptID != nil {
		except = *req.ExceptID
	}
	ms, err := h.employees.Similar(r.Context(), req.FirstName, req.LastName, except)
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]matchJSON, len(ms))
	for i, m := range ms {
		out[i] = matchJSON{Employee: toEmployeeJSON(r, m.Employee), Kind: m.Kind}
	}
	writeJSON(w, http.StatusOK, out)
}

type pairJSON struct {
	A    employeeJSON       `json:"a"`
	B    employeeJSON       `json:"b"`
	Kind employee.MatchKind `json:"kind"`
}

func (h *employeeHandler) possibleDuplicates(w http.ResponseWriter, r *http.Request) {
	ps, err := h.employees.PossibleDuplicates(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]pairJSON, len(ps))
	for i, p := range ps {
		out[i] = pairJSON{A: toEmployeeJSON(r, p.A), B: toEmployeeJSON(r, p.B), Kind: p.Kind}
	}
	writeJSON(w, http.StatusOK, out)
}

type distinctPairRequest struct {
	EmployeeA uuid.UUID `json:"employee_a"`
	EmployeeB uuid.UUID `json:"employee_b"`
}

// markDistinct is Not the Same Person.
func (h *employeeHandler) markDistinct(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req distinctPairRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if err := h.employees.MarkDistinct(r.Context(), req.EmployeeA, req.EmployeeB, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type mergePreviewJSON struct {
	Keep     employeeJSON           `json:"keep"`
	Remove   employeeJSON           `json:"remove"`
	Contents employee.MergeContents `json:"contents"`
}

// mergePair is the path's record kept ({id}) and record removed ({remove}).
func mergePair(r *http.Request) (keep, remove uuid.UUID, err error) {
	if keep, err = parseUUIDPath(r, "id"); err != nil {
		return
	}
	remove, err = parseUUIDPath(r, "remove")
	return
}

// mergePreview is Merge Employees' review: both records and what would move.
func (h *employeeHandler) mergePreview(w http.ResponseWriter, r *http.Request) {
	keep, remove, err := mergePair(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	p, err := h.employees.MergePreview(r.Context(), keep, remove)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, mergePreviewJSON{Keep: toEmployeeJSON(r, p.Keep), Remove: toEmployeeJSON(r, p.Remove), Contents: p.Contents})
}

// merge is Merge Employees: the body is the record kept as chosen on the
// review, as Edit takes it. It answers with the record kept.
func (h *employeeHandler) merge(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	keep, remove, err := mergePair(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req employeeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	e, err := h.employees.Merge(r.Context(), keep, remove, req.params(), employeeRights(r), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toEmployeeJSON(r, e))
}
