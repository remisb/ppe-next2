package main

import (
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/mailtemplate"
	"github.com/remisb/ppe-next2/internal/domain/role"
)

type mailTemplateHandler struct {
	templates *mailtemplate.Service
}

// registerMailTemplateRoutes mounts /api/v1/mail-templates: Administration's
// Mail Templates reads, edits and previews them. The emails themselves are
// prepared where they are used (a SIM card's activation and blocking emails
// under /api/v1/assets).
func registerMailTemplateRoutes(rt *router, svc *mailtemplate.Service) {
	h := &mailTemplateHandler{templates: svc}
	rt.restricted("GET /api/v1/mail-templates", h.list, role.MailTemplatesManage)
	rt.restricted("GET /api/v1/mail-templates/{key}", h.get, role.MailTemplatesManage)
	rt.restricted("PUT /api/v1/mail-templates/{key}", h.update, role.MailTemplatesManage)
	rt.restricted("POST /api/v1/mail-templates/{key}/preview", h.preview, role.MailTemplatesManage)
}

// mailTemplateJSON is a use case's template with what the editor needs: the
// fields it may use, the default it is reset to, and the id its changes are
// recorded under. updated_at and updated_by_user_id are null while it is the
// default never saved.
type mailTemplateJSON struct {
	Key string `json:"key"`
	mailtemplate.Text
	Fields          []mailtemplate.Field `json:"fields"`
	Default         mailtemplate.Text    `json:"default"`
	IsDefault       bool                 `json:"is_default"`
	EntityID        uuid.UUID            `json:"entity_id"`
	UpdatedAt       *time.Time           `json:"updated_at"`
	UpdatedByUserID *uuid.UUID           `json:"updated_by_user_id"`
}

func toMailTemplateJSON(t mailtemplate.Template) mailTemplateJSON {
	u, _ := mailtemplate.Find(t.Key)
	return mailTemplateJSON{
		Key: t.Key, Text: t.Text, Fields: u.Fields, Default: u.Default, IsDefault: t.Text == u.Default,
		EntityID: mailtemplate.EntityID(t.Key), UpdatedAt: t.UpdatedAt, UpdatedByUserID: t.UpdatedByUserID,
	}
}

func (h *mailTemplateHandler) list(w http.ResponseWriter, r *http.Request) {
	list, err := h.templates.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]mailTemplateJSON, len(list))
	for i, t := range list {
		out[i] = toMailTemplateJSON(t)
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *mailTemplateHandler) get(w http.ResponseWriter, r *http.Request) {
	t, err := h.templates.Get(r.Context(), r.PathValue("key"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toMailTemplateJSON(t))
}

// mailTextRequest is a template's text, saved or previewed; cc empty or
// absent for no one.
type mailTextRequest struct {
	To      string `json:"to"`
	CC      string `json:"cc"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

func (q mailTextRequest) params() mailtemplate.TextParams {
	return mailtemplate.TextParams{To: q.To, CC: q.CC, Subject: q.Subject, Body: q.Body}
}

func (h *mailTemplateHandler) update(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req mailTextRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	t, err := h.templates.Update(r.Context(), r.PathValue("key"), req.params(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toMailTemplateJSON(t))
}

// preview renders unsaved text with the use case's samples; nothing is saved.
func (h *mailTemplateHandler) preview(w http.ResponseWriter, r *http.Request) {
	var req mailTextRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	m, err := h.templates.Preview(r.PathValue("key"), req.params())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}
