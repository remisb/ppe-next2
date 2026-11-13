package main

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/personnel/document"
	"github.com/remisb/ppe-next2/internal/personnel/scan"
)

// Personnel files' kept scans (ADR 0007 amendment, docs/specs/personnel-service.md
// "Kept scans"): Import Documents' Scan Document keeps a person's document
// pages as a zip for a few days, for the user who made it alone. The person's
// name is never in a URL, a log line or an audit event: only the archive's
// Content-Disposition carries it.
type scanHandler struct {
	scans *scan.Service
}

func registerPersonnelScanRoutes(rt *router, scans *scan.Service) {
	h := &scanHandler{scans: scans}
	rt.restricted("POST /api/v1/personnel/scans", h.keep, role.PersonnelDocumentsManage)
	rt.restricted("GET /api/v1/personnel/scans", h.list, role.PersonnelDocumentsManage)
	rt.restricted("GET /api/v1/personnel/scans/{id}/archive", h.archive, role.PersonnelDocumentsManage)
	rt.restricted("DELETE /api/v1/personnel/scans/{id}", h.remove, role.PersonnelDocumentsManage)
}

// keepLimit is the most a Keep may send: ten pages of 5 MB and the JSON.
const keepLimit = scan.MaxPages*document.MaxCopySize + 256<<10

// keepShape is the 400 a Keep of another shape gets.
const keepShape = `send multipart/form-data with a "scan" part (JSON) and the pages as page-1 … page-10`

// keep takes a scan as multipart/form-data: the "scan" part (JSON: surname,
// given_names, kind, number, mrz) and the pages, in order, as page-1 …
// page-N, each a JPEG.
func (h *scanHandler) keep(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, keepLimit)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, r, scan.ErrPageTooLarge)
			return
		}
		writeErrorMessage(w, http.StatusBadRequest, keepShape)
		return
	}
	defer r.MultipartForm.RemoveAll()
	body := r.MultipartForm.Value["scan"]
	if len(body) != 1 || len(r.MultipartForm.Value) != 1 {
		writeErrorMessage(w, http.StatusBadRequest, keepShape)
		return
	}
	var meta scan.Meta
	dec := json.NewDecoder(strings.NewReader(body[0]))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&meta); err != nil {
		writeError(w, r, errBadRequest)
		return
	}
	files := r.MultipartForm.File
	if len(files) > scan.MaxPages {
		writeError(w, r, scan.ErrTooManyPages)
		return
	}
	pages := make([][]byte, len(files))
	for name, parts := range files {
		n, ok := pageNumber(name)
		if !ok || n > len(files) || len(parts) != 1 {
			writeErrorMessage(w, http.StatusBadRequest, keepShape)
			return
		}
		f, err := parts[0].Open()
		if err != nil {
			writeError(w, r, err)
			return
		}
		data, err := io.ReadAll(io.LimitReader(f, document.MaxCopySize+1))
		f.Close()
		if err != nil {
			writeError(w, r, err)
			return
		}
		pages[n-1] = data
	}
	kept, err := h.scans.Keep(r.Context(), meta, pages, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeNoStore(w)
	writeJSON(w, http.StatusCreated, kept)
}

// pageNumber reads a part's name, page-1 … page-10, as its number.
func pageNumber(name string) (int, bool) {
	rest, ok := strings.CutPrefix(name, "page-")
	if !ok || rest == "" || rest[0] == '0' {
		return 0, false
	}
	n, err := strconv.Atoi(rest)
	return n, err == nil && n >= 1 && n <= scan.MaxPages
}

// list answers the signed-in user's own scans not yet expired, newest first.
func (h *scanHandler) list(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	scans, err := h.scans.List(r.Context(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeNoStore(w)
	writeJSON(w, http.StatusOK, scans)
}

// archive answers the user's own scan as application/zip, named only in
// Content-Disposition; the download is recorded first.
func (h *scanHandler) archive(w http.ResponseWriter, r *http.Request) {
	id, actor, ok := idAndActor(w, r)
	if !ok {
		return
	}
	a, err := h.scans.Open(r.Context(), id, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeNoStore(w)
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": a.FileName}))
	w.Header().Set("Content-Length", strconv.Itoa(len(a.Zip)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	w.Write(a.Zip)
}

// remove deletes the user's own scan.
func (h *scanHandler) remove(w http.ResponseWriter, r *http.Request) {
	id, actor, ok := idAndActor(w, r)
	if !ok {
		return
	}
	if err := h.scans.Remove(r.Context(), id, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
