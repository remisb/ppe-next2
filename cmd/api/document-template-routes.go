package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/docpdf"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/vault"
	vaultdoc "github.com/remisb/ppe-next2/internal/vault/document"
	"github.com/remisb/ppe-next2/internal/vault/docx"
	vaulttemplate "github.com/remisb/ppe-next2/internal/vault/template"
)

type templateHandler struct {
	templates *vaulttemplate.Service
	documents *vaultdoc.Service
}

// registerDocumentTemplateRoutes mounts Administration's Document Templates
// (document_templates.manage) and the staff app's Generate Document… (the
// type's manage permission, which the service checks) (ADR 0008 phase 3,
// docs/specs/document-template-service.md).
func registerDocumentTemplateRoutes(rt *router, templates *vaulttemplate.Service, documents *vaultdoc.Service) {
	h := &templateHandler{templates: templates, documents: documents}
	rt.restricted("GET /api/v1/document-templates", h.list, role.DocumentTemplatesManage)
	rt.restricted("GET /api/v1/document-templates/fields", h.fields, role.DocumentTemplatesManage)
	rt.restricted("POST /api/v1/document-templates", h.create, role.DocumentTemplatesManage)
	rt.restricted("GET /api/v1/document-templates/{id}", h.get, role.DocumentTemplatesManage)
	rt.restricted("PUT /api/v1/document-templates/{id}", h.update, role.DocumentTemplatesManage)
	rt.restricted("PUT /api/v1/document-templates/{id}/draft", h.saveDraft, role.DocumentTemplatesManage)
	rt.restricted("POST /api/v1/document-templates/{id}/draft/docx", h.uploadDocx, role.DocumentTemplatesManage)
	rt.restricted("GET /api/v1/document-templates/{id}/versions/{n}/docx", h.downloadDocx, role.DocumentTemplatesManage)
	rt.restricted("POST /api/v1/document-templates/{id}/publish", h.publish, role.DocumentTemplatesManage)
	rt.restricted("POST /api/v1/document-templates/{id}/retire", h.retire, role.DocumentTemplatesManage)
	rt.restricted("POST /api/v1/document-templates/preview", h.previewDraft, role.DocumentTemplatesManage)
	rt.restrictedAny("GET /api/v1/vault/templates", h.forGenerate, vaultManagers...)
	rt.restrictedAny("POST /api/v1/vault/generate/preview", h.previewDocument, vaultManagers...)
	rt.restrictedAny("POST /api/v1/vault/generate", h.generate, vaultManagers...)
	rt.restrictedAny("GET /api/v1/vault/renders/{id}", h.render, vaultManagers...)
}

func (h *templateHandler) list(w http.ResponseWriter, r *http.Request) {
	list, err := h.templates.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// fieldsAnswer is what the editor offers: the fields the app fills in, and
// the types a template may be for.
type fieldsAnswer struct {
	Fields []vaulttemplate.Field `json:"fields"`
	Types  []vault.Type          `json:"types"`
}

func (h *templateHandler) fields(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, fieldsAnswer{Fields: vaulttemplate.AppFields(), Types: vaulttemplate.Generatable()})
}

func (h *templateHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, req, ok := withBody[vaulttemplate.Details](w, r)
	if !ok {
		return
	}
	t, err := h.templates.Create(r.Context(), req, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

// templateID is the path's template id.
func templateID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return uuid.Nil, false
	}
	return id, true
}

func (h *templateHandler) get(w http.ResponseWriter, r *http.Request) {
	id, ok := templateID(w, r)
	if !ok {
		return
	}
	t, err := h.templates.Get(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (h *templateHandler) update(w http.ResponseWriter, r *http.Request) {
	id, ok := templateID(w, r)
	if !ok {
		return
	}
	actor, req, ok := withBody[vaulttemplate.Details](w, r)
	if !ok {
		return
	}
	if req.Type != "" {
		writeErrorMessage(w, http.StatusBadRequest, "a template's type cannot be changed")
		return
	}
	t, err := h.templates.Update(r.Context(), id, req, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// draftRequest is a draft's body (ppe.blocks.v1, decoded strictly) and asked fields.
type draftRequest struct {
	Body  json.RawMessage       `json:"body"`
	Asked []vaulttemplate.Asked `json:"asked"`
}

// draft reads a draft request's body.
func draft(w http.ResponseWriter, r *http.Request) (uuid.UUID, vaulttemplate.Body, []vaulttemplate.Asked, bool) {
	actor, req, ok := withBody[draftRequest](w, r)
	if !ok {
		return uuid.Nil, vaulttemplate.Body{}, nil, false
	}
	body, err := vaulttemplate.DecodeBody(req.Body)
	if err != nil {
		writeError(w, r, err)
		return uuid.Nil, vaulttemplate.Body{}, nil, false
	}
	return actor, body, req.Asked, true
}

func (h *templateHandler) saveDraft(w http.ResponseWriter, r *http.Request) {
	id, ok := templateID(w, r)
	if !ok {
		return
	}
	actor, body, asked, ok := draft(w, r)
	if !ok {
		return
	}
	t, err := h.templates.SaveDraft(r.Context(), id, body, asked, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (h *templateHandler) publish(w http.ResponseWriter, r *http.Request) {
	id, ok := templateID(w, r)
	if !ok {
		return
	}
	actor, ok := actorOf(w, r)
	if !ok {
		return
	}
	t, err := h.templates.Publish(r.Context(), id, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (h *templateHandler) retire(w http.ResponseWriter, r *http.Request) {
	id, ok := templateID(w, r)
	if !ok {
		return
	}
	actor, ok := actorOf(w, r)
	if !ok {
		return
	}
	t, err := h.templates.Retire(r.Context(), id, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// previewDraftRequest is the editor's preview: a body and asked fields as
// edited, drawn with the fields' samples, in language.
type previewDraftRequest struct {
	Body     json.RawMessage       `json:"body"`
	Asked    []vaulttemplate.Asked `json:"asked"`
	Language string                `json:"language"`
	Name     string                `json:"name"`
}

// pdfAnswer is a PDF in JSON, base64, with what Generate must be given back.
type pdfAnswer struct {
	PDF        string `json:"pdf"`
	ValuesHash string `json:"values_hash,omitempty"`
}

func (h *templateHandler) previewDraft(w http.ResponseWriter, r *http.Request) {
	_, req, ok := withBody[previewDraftRequest](w, r)
	if !ok {
		return
	}
	body, err := vaulttemplate.DecodeBody(req.Body)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if err := vaulttemplate.CheckAsked(req.Asked); err != nil {
		writeError(w, r, err)
		return
	}
	if err := body.Check(func(k string) bool { return vaulttemplate.Known(k, req.Asked) }); err != nil {
		writeError(w, r, err)
		return
	}
	samples := vaulttemplate.Samples(req.Asked)
	value := func(k string) string {
		if v := samples[k]; v != "" {
			return vaulttemplate.Written(k, v, req.Language)
		}
		return "[" + vaulttemplate.Label(k, req.Asked) + "]"
	}
	pdf, err := docpdf.Render(body, value, docpdf.Options{Title: req.Name, Footer: "PREVIEW · " + req.Name, PageWord: "page", OfWord: "of", Created: time.Now().UTC()})
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, pdfAnswer{PDF: base64.StdEncoding.EncodeToString(pdf)})
}

// generatable is a published template Generate Document… offers.
type generatable struct {
	ID       uuid.UUID             `json:"id"`
	Type     string                `json:"type"`
	Name     string                `json:"name"`
	Language string                `json:"language"`
	Version  int                   `json:"version"`
	Asked    []vaulttemplate.Asked `json:"asked"`
}

// forGenerate lists the published templates of the types the reader may change.
func (h *templateHandler) forGenerate(w http.ResponseWriter, r *http.Request) {
	reader, err := vaultReader(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	list, err := h.templates.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]generatable, 0)
	for _, t := range list {
		ty, ok := vault.TypeOf(t.Type)
		v, published := t.Published()
		if !ok || !published || t.Retired || !holdsAll(reader.Perms, ty.Read, ty.Manage) {
			continue
		}
		out = append(out, generatable{ID: t.ID, Type: t.Type, Name: t.Name, Language: t.Language, Version: v.Number, Asked: v.Asked})
	}
	writeJSON(w, http.StatusOK, out)
}

// holdsAll is whether perms has every one of want.
func holdsAll(perms []string, want ...string) bool {
	for _, p := range want {
		found := false
		for _, q := range perms {
			found = found || q == p
		}
		if !found {
			return false
		}
	}
	return true
}

// generateRequest is Generate Document…'s choices; Generate also gives back
// the preview's values_hash.
type generateRequest struct {
	TemplateID   uuid.UUID         `json:"template_id"`
	EmployeeID   uuid.UUID         `json:"employee_id"`
	EmploymentID *uuid.UUID        `json:"employment_id"`
	Inputs       map[string]string `json:"inputs"`
	ValuesHash   string            `json:"values_hash"`
}

func (req generateRequest) request() vaultdoc.GenerateRequest {
	return vaultdoc.GenerateRequest{TemplateID: req.TemplateID, EmployeeID: req.EmployeeID, EmploymentID: req.EmploymentID, Inputs: req.Inputs}
}

func (h *templateHandler) previewDocument(w http.ResponseWriter, r *http.Request) {
	reader, err := vaultReader(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req generateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	p, err := h.documents.Preview(r.Context(), reader, req.request())
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	if p.Render != nil {
		// A DOCX template: the worker converts it; GET /vault/renders/{id} answers its PDF.
		writeJSON(w, http.StatusAccepted, renderAnswer{RenderID: p.Render, State: vaultdoc.RenderPending, ValuesHash: p.ValuesHash})
		return
	}
	writeJSON(w, http.StatusOK, pdfAnswer{PDF: base64.StdEncoding.EncodeToString(p.PDF), ValuesHash: p.ValuesHash})
}

func (h *templateHandler) generate(w http.ResponseWriter, r *http.Request) {
	reader, err := vaultReader(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req generateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	g, err := h.documents.Generate(r.Context(), reader, req.request(), req.ValuesHash)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if g.Render != nil {
		// A DOCX template: the document is made once the worker has its PDF.
		writeJSON(w, http.StatusAccepted, renderAnswer{RenderID: g.Render, State: vaultdoc.RenderPending})
		return
	}
	writeJSON(w, http.StatusCreated, g.Document)
}

// renderAnswer is a render as the app polls it (phase 8): 202 while the
// worker converts it; then a preview's PDF and values hash, or the document.
type renderAnswer struct {
	RenderID   *uuid.UUID         `json:"render_id,omitempty"`
	State      string             `json:"state"`
	PDF        string             `json:"pdf,omitempty"`
	ValuesHash string             `json:"values_hash,omitempty"`
	Document   *vaultdoc.Document `json:"document,omitempty"`
}

// render answers the reader's own render: 202 pending; 200 with a preview's
// PDF; 201 with the document made from it (the same document when asked again).
func (h *templateHandler) render(w http.ResponseWriter, r *http.Request) {
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
	got, err := h.documents.GetRender(r.Context(), reader, id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	switch {
	case got.State == vaultdoc.RenderPending:
		writeJSON(w, http.StatusAccepted, renderAnswer{RenderID: &id, State: got.State})
	case got.Document != nil:
		writeJSON(w, http.StatusCreated, renderAnswer{RenderID: &id, State: got.State, Document: got.Document})
	default:
		writeJSON(w, http.StatusOK, renderAnswer{RenderID: &id, State: got.State, PDF: base64.StdEncoding.EncodeToString(got.PDF), ValuesHash: got.ValuesHash})
	}
}

// uploadDocx is Upload DOCX Template: the file, and the asked fields as JSON
// in the "asked" part; it becomes the template's draft.
func (h *templateHandler) uploadDocx(w http.ResponseWriter, r *http.Request) {
	id, ok := templateID(w, r)
	if !ok {
		return
	}
	actor, ok := actorOf(w, r)
	if !ok {
		return
	}
	const shape = `send multipart/form-data with the DOCX as "file" and the asked fields as JSON in "asked"`
	if !parseMultipart(w, r, docx.MaxBytes+64<<10, vaulttemplate.ErrTooLarge, shape) {
		return
	}
	defer r.MultipartForm.RemoveAll()
	asked := []vaulttemplate.Asked{}
	if raw := r.FormValue("asked"); raw != "" {
		dec := json.NewDecoder(strings.NewReader(raw))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&asked); err != nil {
			writeErrorMessage(w, http.StatusBadRequest, "asked: "+err.Error())
			return
		}
	}
	data, name, ok := formFile(w, r, "file", docx.MaxBytes, shape)
	if !ok {
		return
	}
	t, err := h.templates.UploadDocx(r.Context(), id, name, data, asked, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// downloadDocx sends a DOCX version's file, as uploaded.
func (h *templateHandler) downloadDocx(w http.ResponseWriter, r *http.Request) {
	id, ok := templateID(w, r)
	if !ok {
		return
	}
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil {
		writeError(w, r, vaulttemplate.ErrNotFound)
		return
	}
	t, err := h.templates.Get(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	i := slices.IndexFunc(t.Versions, func(v vaulttemplate.Version) bool { return v.Number == n })
	if i < 0 || t.Versions[i].Docx == nil {
		writeError(w, r, vaulttemplate.ErrNotFound)
		return
	}
	data, err := h.templates.DocxBytes(r.Context(), t.Versions[i])
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeAttachment(w, t.Versions[i].Docx.Name, docx.ContentType, data)
}
