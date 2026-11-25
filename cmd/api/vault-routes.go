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

// The permissions that open the vault's routes: a document's type names the
// one it needs, which the service checks (ADR 0008, docs/specs/vault-service.md).
var (
	vaultReaders  = []role.Permission{role.VaultRead, role.VaultEmploymentRead}
	vaultManagers = []role.Permission{role.VaultManage, role.VaultEmploymentManage}
)

// registerVaultRoutes mounts /api/v1/vault. A sealed document's file opens
// only by POST with a recent sign-in, recorded first (sensitive).
func registerVaultRoutes(rt *router, documents *vaultdoc.Service, sensitive func(role.Permission, http.HandlerFunc) http.HandlerFunc) {
	h := &vaultHandler{documents: documents}
	rt.restrictedAny("GET /api/v1/vault/types", h.types, vaultReaders...)
	rt.restrictedAny("POST /api/v1/vault/search", h.search, vaultReaders...)
	rt.restrictedAny("GET /api/v1/vault/by-subject/{kind}/{id}", h.bySubject, vaultReaders...)
	rt.restrictedAny("POST /api/v1/vault/documents", h.upload, vaultManagers...)
	rt.restrictedAny("GET /api/v1/vault/documents/{id}", h.get, vaultReaders...)
	rt.restrictedAny("PUT /api/v1/vault/documents/{id}", h.update, vaultManagers...)
	rt.restrictedAny("DELETE /api/v1/vault/documents/{id}", h.remove, vaultManagers...)
	rt.restrictedAny("PUT /api/v1/vault/documents/{id}/hold", h.hold, vaultManagers...)
	rt.restrictedAny("POST /api/v1/vault/documents/{id}/versions", h.addVersion, vaultManagers...)
	rt.restrictedAny("GET /api/v1/vault/documents/{id}/versions/{n}/file", h.file, vaultReaders...)
	rt.restrictedAny("POST /api/v1/vault/documents/{id}/versions/{n}/read-again", h.readAgain, vaultManagers...)
	rt.restrictedAny("GET /api/v1/vault/documents/{id}/verify", h.verify, vaultReaders...)
	rt.restricted("POST /api/v1/vault/documents/{id}/versions/{n}/file",
		sensitive(role.VaultEmploymentRead, h.sealedFile), role.VaultEmploymentRead)
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

// readAgain is Read Again on a version: its file read for search once more, by the worker.
func (h *vaultHandler) readAgain(w http.ResponseWriter, r *http.Request) {
	reader, id, ok := vaultDocument(w, r)
	if !ok {
		return
	}
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < 1 {
		writeError(w, r, vaultdoc.ErrNotFound)
		return
	}
	d, err := h.documents.ReadAgain(r.Context(), reader, id, n)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, d)
}

// verify checks an archived document against its source (phase 6): its file
// against its hash, and its hash against the source's snapshot hashed again.
func (h *vaultHandler) verify(w http.ResponseWriter, r *http.Request) {
	reader, id, ok := vaultDocument(w, r)
	if !ok {
		return
	}
	v, err := h.documents.Verify(r.Context(), reader, id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, v)
}

// sealedFile sends a sealed document's file, after the sensitive check (a
// recent sign-in) and once its opening is recorded.
func (h *vaultHandler) sealedFile(w http.ResponseWriter, r *http.Request) {
	reader, id, ok := vaultDocument(w, r)
	if !ok {
		return
	}
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < 1 {
		writeError(w, r, vaultdoc.ErrNotFound)
		return
	}
	f, data, err := h.documents.OpenSealed(r.Context(), reader, id, n)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeAttachment(w, f.FileName, f.ContentType, data)
}

// holdRequest is Legal Hold: a day and a reason, or null to clear it.
type holdRequest struct {
	HoldUntil  *string `json:"hold_until"`
	HoldReason string  `json:"hold_reason"`
}

func (h *vaultHandler) hold(w http.ResponseWriter, r *http.Request) {
	reader, id, ok := vaultDocument(w, r)
	if !ok {
		return
	}
	var req holdRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	d, err := h.documents.SetHold(r.Context(), reader, id, req.HoldUntil, req.HoldReason)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
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
