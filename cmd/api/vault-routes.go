package main

import (
	"encoding/json"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/vault"
	vaultdoc "github.com/remisb/ppe-next2/internal/vault/document"
)

type vaultHandler struct {
	documents *vaultdoc.Service
}

// registerVaultRoutes mounts /api/v1/vault (ADR 0008, docs/specs/vault-service.md).
// Phase 1's types all need vault.read to see and vault.manage to change; the
// service checks each document's type and links too.
func registerVaultRoutes(rt *router, documents *vaultdoc.Service) {
	h := &vaultHandler{documents: documents}
	rt.restricted("GET /api/v1/vault/types", h.types, role.VaultRead)
	rt.restricted("POST /api/v1/vault/search", h.search, role.VaultRead)
	rt.restricted("GET /api/v1/vault/by-subject/{kind}/{id}", h.bySubject, role.VaultRead)
	rt.restricted("POST /api/v1/vault/documents", h.upload, role.VaultManage)
	rt.restricted("GET /api/v1/vault/documents/{id}", h.get, role.VaultRead)
	rt.restricted("PUT /api/v1/vault/documents/{id}", h.update, role.VaultManage)
	rt.restricted("DELETE /api/v1/vault/documents/{id}", h.remove, role.VaultManage)
	rt.restricted("POST /api/v1/vault/documents/{id}/versions", h.addVersion, role.VaultManage)
	rt.restricted("GET /api/v1/vault/documents/{id}/versions/{n}/file", h.file, role.VaultRead)
}

// vaultReader is the request's user and the permissions their token grants.
func vaultReader(r *http.Request) (vaultdoc.Reader, error) {
	id, err := actorID(r)
	if err != nil {
		return vaultdoc.Reader{}, err
	}
	c, _ := middleware.ClaimsFromContext(r.Context())
	return vaultdoc.Reader{ID: id, Perms: c.Roles}, nil
}

func (h *vaultHandler) types(w http.ResponseWriter, r *http.Request) {
	reader, err := vaultReader(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, h.documents.Types(reader))
}

// searchRequest is a search's body: a POST, so the words (often a person's
// name) are never in a URL or the request log.
type searchRequest struct {
	Query   string            `json:"query"`
	Types   []string          `json:"types"`
	Subject *vaultdoc.LinkRef `json:"subject"`
	Page    int               `json:"page"`
}

func (h *vaultHandler) search(w http.ResponseWriter, r *http.Request) {
	reader, err := vaultReader(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req searchRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	p, err := h.documents.Search(r.Context(), reader, vaultdoc.Query{Words: req.Query, Types: req.Types, Subject: req.Subject, Page: req.Page})
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, p)
}

func (h *vaultHandler) bySubject(w http.ResponseWriter, r *http.Request) {
	reader, err := vaultReader(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	kind := vault.SubjectKind(r.PathValue("kind"))
	known := false
	for _, k := range vault.SubjectKinds() {
		known = known || k == kind
	}
	if !known {
		writeError(w, r, vaultdoc.ErrSubjectNotFound)
		return
	}
	hits, err := h.documents.BySubject(r.Context(), reader, vaultdoc.LinkRef{Kind: kind, ID: id})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, hits)
}

// detailsRequest is a document's editable fields, as Upload's "document" part
// and Update's body send them.
type detailsRequest struct {
	Type         string             `json:"type"`
	Title        string             `json:"title"`
	DocumentDate *string            `json:"document_date"`
	ValidFrom    *string            `json:"valid_from"`
	ValidUntil   *string            `json:"valid_until"`
	Links        []vaultdoc.LinkRef `json:"links"`
	Note         string             `json:"note"`
}

func (req detailsRequest) details() vaultdoc.Details {
	return vaultdoc.Details{Title: req.Title, DocumentDate: req.DocumentDate, ValidFrom: req.ValidFrom, ValidUntil: req.ValidUntil, Links: req.Links}
}

// maxUploadBody is the largest upload's body: the file and a little for the form around it.
const maxUploadBody = vault.MaxUploadBytes + 64<<10

// uploadShape is what a malformed upload is told.
const uploadShape = `send multipart/form-data with the file in a field named file and the details as JSON in a field named document`

// multipartUpload reads an upload's file and JSON "document" part into dst.
func multipartUpload(w http.ResponseWriter, r *http.Request, dst *detailsRequest, needDetails bool) ([]byte, string, bool) {
	if !parseMultipart(w, r, maxUploadBody, vaultdoc.ErrTooLarge, uploadShape) {
		return nil, "", false
	}
	raw := r.FormValue("document")
	if raw == "" && needDetails {
		writeErrorMessage(w, http.StatusBadRequest, uploadShape)
		return nil, "", false
	}
	if raw != "" {
		dec := json.NewDecoder(strings.NewReader(raw))
		dec.DisallowUnknownFields()
		if err := dec.Decode(dst); err != nil {
			writeErrorMessage(w, http.StatusBadRequest, "document: "+err.Error())
			return nil, "", false
		}
	}
	return formFile(w, r, "file", vault.MaxUploadBytes, uploadShape)
}

func (h *vaultHandler) upload(w http.ResponseWriter, r *http.Request) {
	reader, err := vaultReader(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req detailsRequest
	data, name, ok := multipartUpload(w, r, &req, true)
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	if !ok {
		return
	}
	d, err := h.documents.Upload(r.Context(), reader, req.Type, req.details(), vaultdoc.Upload{FileName: name, Data: data, Note: req.Note})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

// vaultDocument runs next with the reader and the path's document id.
func vaultDocument(w http.ResponseWriter, r *http.Request) (vaultdoc.Reader, uuid.UUID, bool) {
	reader, err := vaultReader(r)
	if err != nil {
		writeError(w, r, err)
		return vaultdoc.Reader{}, uuid.Nil, false
	}
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return vaultdoc.Reader{}, uuid.Nil, false
	}
	return reader, id, true
}

func (h *vaultHandler) get(w http.ResponseWriter, r *http.Request) {
	reader, id, ok := vaultDocument(w, r)
	if !ok {
		return
	}
	d, err := h.documents.Get(r.Context(), reader, id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (h *vaultHandler) update(w http.ResponseWriter, r *http.Request) {
	reader, id, ok := vaultDocument(w, r)
	if !ok {
		return
	}
	var req detailsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if req.Type != "" || req.Note != "" {
		writeErrorMessage(w, http.StatusBadRequest, "a document's type and a version's note cannot be changed")
		return
	}
	d, err := h.documents.Update(r.Context(), reader, id, req.details())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (h *vaultHandler) remove(w http.ResponseWriter, r *http.Request) {
	reader, id, ok := vaultDocument(w, r)
	if !ok {
		return
	}
	if err := h.documents.Remove(r.Context(), reader, id); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *vaultHandler) addVersion(w http.ResponseWriter, r *http.Request) {
	reader, id, ok := vaultDocument(w, r)
	if !ok {
		return
	}
	var req detailsRequest
	data, name, ok := multipartUpload(w, r, &req, false)
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	if !ok {
		return
	}
	if req.Type != "" || req.Title != "" || req.Links != nil || req.DocumentDate != nil || req.ValidFrom != nil || req.ValidUntil != nil {
		writeErrorMessage(w, http.StatusBadRequest, "a new version takes a file and a note only")
		return
	}
	d, err := h.documents.AddVersion(r.Context(), reader, id, vaultdoc.Upload{FileName: name, Data: data, Note: req.Note})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

// file sends a version's main file as an attachment, never shown inside the
// page: its type is the one sniffed on upload, and the browser may not guess another.
func (h *vaultHandler) file(w http.ResponseWriter, r *http.Request) {
	reader, id, ok := vaultDocument(w, r)
	if !ok {
		return
	}
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < 1 {
		writeError(w, r, vaultdoc.ErrNotFound)
		return
	}
	f, data, err := h.documents.Open(r.Context(), reader, id, n)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeAttachment(w, f.FileName, f.ContentType, data)
}

// writeAttachment sends data as a download named name: never shown inside the
// page, never cached, its type not to be guessed.
func writeAttachment(w http.ResponseWriter, name, contentType string, data []byte) {
	hd := w.Header()
	hd.Set("Content-Type", contentType)
	hd.Set("Content-Length", strconv.Itoa(len(data)))
	hd.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
