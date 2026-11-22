package main

import (
	"fmt"
	"net/http"
	"slices"

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
	// Employment (docs/specs/employee-service.md): periods at a company, which
	// make the person an employee, a former employee or a candidate.
	rt.restricted("POST /api/v1/employees/{id}/employments", h.employ, role.EmployeeProfilesManage)
	rt.restricted("PUT /api/v1/employees/{id}/employments/{eid}", h.updateEmployment, role.EmployeeProfilesManage)
	rt.restricted("POST /api/v1/employees/{id}/employments/{eid}/end", h.endEmployment, role.EmployeeProfilesManage)
	rt.restricted("DELETE /api/v1/employees/{id}/employments/{eid}", h.removeEmployment, role.EmployeeProfilesManage)
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

// createEmployeeRequest is Add New Employee's: the employee and, for an
// employee rather than a candidate, the employment.
type createEmployeeRequest struct {
	employeeRequest
	Employment *employRequest `json:"employment"`
}

// employRequest opens a period: Employ, Move to Another Company (end_current)
// and Add New Employee's employment. started_on is YYYY-MM-DD, optional.
type employRequest struct {
	CompanyID  uuid.UUID `json:"company_id"`
	StartedOn  *string   `json:"started_on"`
	EndCurrent bool      `json:"end_current"`
}

func (req employRequest) params() employee.EmployParams {
	return employee.EmployParams{CompanyID: req.CompanyID, StartedOn: req.StartedOn, EndCurrent: req.EndCurrent}
}

// employmentRequest replaces a period's company and dates (Edit Employment).
type employmentRequest struct {
	CompanyID uuid.UUID `json:"company_id"`
	StartedOn *string   `json:"started_on"`
	EndedOn   *string   `json:"ended_on"`
}

// endEmploymentRequest is End Employment's: the day the employee left.
type endEmploymentRequest struct {
	EndedOn string `json:"ended_on"`
}

type employeeSizesRequest struct {
	HeightCm     *int    `json:"height_cm"`
	ClothingSize *int    `json:"clothing_size"`
	ShoeSize     *string `json:"shoe_size"`
}

// list is every live employee; ?status=employee|candidate|former and
// ?company=<id> (the open employment's) narrow it.
func (h *employeeHandler) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	status := employee.Status(q.Get("status"))
	if status != "" && !status.Valid() {
		writeError(w, r, fmt.Errorf("%w: status must be employee, candidate or former", employee.ErrInvalid))
		return
	}
	var company *uuid.UUID
	if c := q.Get("company"); c != "" {
		id, err := uuid.Parse(c)
		if err != nil {
			writeError(w, r, fmt.Errorf("%w: company is not an id", employee.ErrInvalid))
			return
		}
		company = &id
	}
	es, err := h.employees.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	if status != "" || company != nil {
		es = slices.DeleteFunc(es, func(e employee.Employee) bool {
			return (status != "" && e.Status != status) || (company != nil && (e.Company == nil || e.Company.ID != *company))
		})
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
	var req createEmployeeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	p := req.params()
	if req.Employment != nil {
		job := req.Employment.params()
		p.Employment = &job
	}
	e, err := h.employees.Create(r.Context(), p, employeeRights(r), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/employees/"+e.ID.String())
	writeJSON(w, http.StatusCreated, toEmployeeJSON(r, e))
}

func (h *employeeHandler) update(w http.ResponseWriter, r *http.Request) {
	id, actor, ok := idAndActor(w, r)
	if !ok {
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
	id, actor, ok := idAndActor(w, r)
	if !ok {
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
	id, actor, ok := idAndActor(w, r)
	if !ok {
		return
	}
	if err := h.employees.Delete(r.Context(), id, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// employmentPath is the path's employee ({id}) and period ({eid}), and the actor.
func employmentPath(w http.ResponseWriter, r *http.Request) (id, eid, actor uuid.UUID, ok bool) {
	if id, actor, ok = idAndActor(w, r); !ok {
		return
	}
	var err error
	if eid, err = parseUUIDPath(r, "eid"); err != nil {
		writeError(w, r, err)
		return id, eid, actor, false
	}
	return id, eid, actor, true
}

// employ is Employ and Move to Another Company; it answers with the employee
// and their employments.
func (h *employeeHandler) employ(w http.ResponseWriter, r *http.Request) {
	id, actor, ok := idAndActor(w, r)
	if !ok {
		return
	}
	var req employRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	e, err := h.employees.Employ(r.Context(), id, req.params(), employeeRights(r), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toEmployeeJSON(r, e))
}

func (h *employeeHandler) updateEmployment(w http.ResponseWriter, r *http.Request) {
	id, eid, actor, ok := employmentPath(w, r)
	if !ok {
		return
	}
	var req employmentRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	e, err := h.employees.UpdateEmployment(r.Context(), id, eid, employee.EmploymentParams{
		CompanyID: req.CompanyID, StartedOn: req.StartedOn, EndedOn: req.EndedOn,
	}, employeeRights(r), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toEmployeeJSON(r, e))
}

func (h *employeeHandler) endEmployment(w http.ResponseWriter, r *http.Request) {
	id, eid, actor, ok := employmentPath(w, r)
	if !ok {
		return
	}
	var req endEmploymentRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	e, err := h.employees.EndEmployment(r.Context(), id, eid, req.EndedOn, employeeRights(r), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toEmployeeJSON(r, e))
}

// removeEmployment removes a period entered by mistake; it answers with the
// employee, a candidate again when it was their only one.
func (h *employeeHandler) removeEmployment(w http.ResponseWriter, r *http.Request) {
	id, eid, actor, ok := employmentPath(w, r)
	if !ok {
		return
	}
	e, err := h.employees.RemoveEmployment(r.Context(), id, eid, employeeRights(r), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toEmployeeJSON(r, e))
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
