package main

import (
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/employeephoto"
)

type employeePhotoHandler struct {
	photos *employeephoto.Service
}

// registerEmployeePhotoRoutes mounts /api/v1/employee-photos/{employee id}
// (under /employees/{id}/… it would clash with /employees/by-name/{q}). Like
// the employee's other details, any signed-in user reads and maintains them.
func registerEmployeePhotoRoutes(rt *router, photos *employeephoto.Service) {
	h := &employeePhotoHandler{photos: photos}
	rt.authenticated("GET /api/v1/employee-photos/{id}", h.list)
	rt.authenticated("POST /api/v1/employee-photos/{id}", h.upload)
	rt.authenticated("GET /api/v1/employee-photos/{id}/{photoID}", h.file)
	rt.authenticated("PUT /api/v1/employee-photos/{id}/{photoID}", h.update)
	rt.authenticated("PUT /api/v1/employee-photos/{id}/{photoID}/default", h.setDefault)
	rt.authenticated("DELETE /api/v1/employee-photos/{id}/{photoID}", h.remove)
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
	p, err := h.photos.Add(r.Context(), id, employeephoto.Upload{FileName: header.Filename, Data: data}, r.MultipartForm.Value["uses"], actor)
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
