package main

import (
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/employeephoto"
	"github.com/remisb/ppe-next2/internal/domain/role"
)

type employeePhotoHandler struct {
	photos *employeephoto.Service
}

// registerEmployeePhotoRoutes mounts /api/v1/employee-photos/{employee id}
// (under /employees/{id}/… it would clash with /employees/by-name/{q}). They
// are the employee's profile: seen with employee_profiles.read, added,
// changed and removed with employee_profiles.manage. Import Documents adds a
// document's portrait as a photo, so adding one also takes
// personnel.documents.manage (ADR 0007).
func registerEmployeePhotoRoutes(rt *router, photos *employeephoto.Service) {
	h := &employeePhotoHandler{photos: photos}
	rt.restricted("GET /api/v1/employee-photos/{id}", h.list, role.EmployeeProfilesRead)
	rt.restrictedAny("POST /api/v1/employee-photos/{id}", h.upload, role.EmployeeProfilesManage, role.PersonnelDocumentsManage)
	rt.restricted("GET /api/v1/employee-photos/{id}/{photoID}", h.file, role.EmployeeProfilesRead)
	rt.restricted("PUT /api/v1/employee-photos/{id}/{photoID}", h.update, role.EmployeeProfilesManage)
	rt.restricted("PUT /api/v1/employee-photos/{id}/{photoID}/default", h.setDefault, role.EmployeeProfilesManage)
	rt.restricted("DELETE /api/v1/employee-photos/{id}/{photoID}", h.remove, role.EmployeeProfilesManage)
}

func (h *employeePhotoHandler) list(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	ps, err := h.photos.List(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, ps)
}

// upload takes a multipart form with one "file" and any number of "uses".
func (h *employeePhotoHandler) upload(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, employeephoto.MaxBytes+64<<10)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, r, employeephoto.ErrFileTooLarge)
			return
		}
		writeErrorMessage(w, http.StatusBadRequest, "send the photo as multipart/form-data, in a field named file")
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, header, err := r.FormFile("file")
	if err != nil {
		writeErrorMessage(w, http.StatusBadRequest, "send the photo as multipart/form-data, in a field named file")
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, employeephoto.MaxBytes+1))
	if err != nil {
		writeError(w, r, err)
		return
	}
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	// An AI-coloured photo (Import Documents' Make Colour Photo) says so, with how the person consented.
	upload := employeephoto.Upload{FileName: header.Filename, Data: data, AIGenerated: r.FormValue("ai_generated") == "true", ConsentBy: r.FormValue("consent")}
	p, err := h.photos.Add(r.Context(), id, upload, r.MultipartForm.Value["uses"], actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

// file sends the photo to be shown in a page. Its type is the one checked on
// upload (an image only), and the browser may not guess another.
func (h *employeePhotoHandler) file(w http.ResponseWriter, r *http.Request) {
	id, photoID, ok := h.ids(w, r)
	if !ok {
		return
	}
	p, body, err := h.photos.Open(r.Context(), id, photoID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer body.Close()
	hd := w.Header()
	hd.Set("Content-Type", p.ContentType)
	hd.Set("Content-Length", strconv.FormatInt(p.SizeBytes, 10))
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Cache-Control", "private, max-age=3600")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, body)
}

type photoUsesRequest struct {
	Uses []string `json:"uses"`
}

// update replaces the photo's uses; send none to clear them.
func (h *employeePhotoHandler) update(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	id, photoID, ok := h.ids(w, r)
	if !ok {
		return
	}
	var req photoUsesRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	p, err := h.photos.SetUses(r.Context(), id, photoID, req.Uses, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (h *employeePhotoHandler) setDefault(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	id, photoID, ok := h.ids(w, r)
	if !ok {
		return
	}
	p, err := h.photos.SetDefault(r.Context(), id, photoID, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (h *employeePhotoHandler) remove(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	id, photoID, ok := h.ids(w, r)
	if !ok {
		return
	}
	if err := h.photos.Remove(r.Context(), id, photoID, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *employeePhotoHandler) ids(w http.ResponseWriter, r *http.Request) (id, photoID uuid.UUID, ok bool) {
	var err error
	if id, err = parseUUIDPath(r, "id"); err == nil {
		photoID, err = parseUUIDPath(r, "photoID")
	}
	if err != nil {
		writeError(w, r, err)
		return uuid.Nil, uuid.Nil, false
	}
	return id, photoID, true
}
