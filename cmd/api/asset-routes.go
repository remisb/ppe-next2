package main

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/asset"
	"github.com/remisb/ppe-next2/internal/domain/role"
)

type assetHandler struct {
	assets *asset.Service
}

// registerAssetRoutes mounts Company Assets (docs/specs/asset-service.md).
// Every signed-in user reads the register; every write needs assets.manage.
// The return and the Not Returned mark act on the asset's open assignment,
// so they are the asset's routes.
func registerAssetRoutes(rt *router, assets *asset.Service) {
	h := &assetHandler{assets: assets}
	rt.authenticated("GET /api/v1/assets", h.list)
	rt.authenticated("GET /api/v1/assets/summary/{kind}", h.summary)
	rt.authenticated("GET /api/v1/assets/by-number/{q}", h.byNumber)
	rt.authenticated("GET /api/v1/assets/by-employee/{id}", h.byEmployee)
	rt.restricted("GET /api/v1/assets/next-number/{prefix}", h.nextNumber, role.AssetsManage)
	rt.authenticated("GET /api/v1/assets/{id}", h.get)
	rt.restricted("POST /api/v1/assets", h.create, role.AssetsManage)
	rt.restricted("PUT /api/v1/assets/{id}", h.update, role.AssetsManage)
	rt.restricted("PUT /api/v1/assets/{id}/status", h.changeStatus, role.AssetsManage)
	rt.restricted("POST /api/v1/assets/{id}/assignments/preview", h.preview, role.AssetsManage)
	rt.restricted("POST /api/v1/assets/{id}/assignments", h.give, role.AssetsManage)
	rt.restricted("POST /api/v1/assets/{id}/return", h.giveBack, role.AssetsManage)
	rt.restricted("POST /api/v1/assets/{id}/not-returned", h.markNotReturned, role.AssetsManage)
	rt.authenticated("GET /api/v1/assets/{id}/assignments/{assignmentID}/form", h.form)
	rt.restricted("POST /api/v1/assets/{id}/assignments/{assignmentID}/signed-copies", h.uploadSignedCopy, role.AssetsManage)
	rt.authenticated("GET /api/v1/assets/{id}/assignments/{assignmentID}/signed-copies/{copyID}", h.signedCopy)
}

// assetParams is an asset's details as Add and Edit send them.
type assetParams struct {
	Category            *asset.Category `json:"category"`
	InventoryNo         string          `json:"inventory_no"`
	Name                *string         `json:"name"`
	SerialNo            *string         `json:"serial_no"`
	SimNo               *string         `json:"sim_no"`
	PhoneNo             *string         `json:"phone_no"`
	Provider            *string         `json:"provider"`
	Plan                *string         `json:"plan"`
	NonReturnValueCents *int64          `json:"non_return_value_cents"`
	ReceivedDate        *string         `json:"received_date"`
	Comment             string          `json:"comment"`
}

func (p assetParams) params() asset.Params {
	return asset.Params{
		Category: p.Category, InventoryNo: p.InventoryNo, Name: p.Name, SerialNo: p.SerialNo, SimNo: p.SimNo,
		PhoneNo: p.PhoneNo, Provider: p.Provider, Plan: p.Plan, NonReturnValueCents: p.NonReturnValueCents,
		ReceivedDate: p.ReceivedDate, Comment: p.Comment,
	}
}

type createAssetRequest struct {
	assetParams
	Kind             asset.Kind    `json:"kind"`
	ConnectionStatus *asset.Status `json:"connection_status"`
}

type statusRequest struct {
	ConnectionStatus string `json:"connection_status"`
}

type formRequest struct {
	EmployeeID          uuid.UUID `json:"employee_id"`
	GivenDate           string    `json:"given_date"`
	Plan                *string   `json:"plan"`
	NonReturnValueCents *int64    `json:"non_return_value_cents"`
}

func (f formRequest) params() asset.FormParams {
	return asset.FormParams{EmployeeID: f.EmployeeID, GivenDate: f.GivenDate, Plan: f.Plan, NonReturnValueCents: f.NonReturnValueCents}
}

type giveRequest struct {
	formRequest
	Comment         string `json:"comment"`
	PaperFormSigned bool   `json:"paper_form_signed"`
	FormHash        string `json:"form_hash"`
}

type returnRequest struct {
	ReturnedDate string `json:"returned_date"`
	Comment      string `json:"comment"`
}

type notReturnedRequest struct {
	Whereabouts string `json:"whereabouts"`
	Comment     string `json:"comment"`
}

// assetListParams are the register's query parameters: a paged search list,
// the domain-service contract's exception to path-segment filters.
var assetListParams = map[string]bool{
	"kind": true, "q": true, "location": true, "held": true, "employee_id": true, "provider": true, "category": true, "status": true,
	"not_returned": true, "signed_copy": true, "sort": true, "dir": true, "page": true, "page_size": true,
}

func (h *assetHandler) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	for k, v := range q {
		if !assetListParams[k] || len(v) > 1 {
			writeErrorMessage(w, http.StatusBadRequest, "unknown or repeated query parameter "+k)
			return
		}
	}
	p := asset.ListParams{
		Kind: q.Get("kind"), Q: q.Get("q"), Location: q.Get("location"), Held: q.Get("held"), Provider: q.Get("provider"), Category: q.Get("category"), Status: q.Get("status"),
		NotReturned: q.Get("not_returned"), SignedCopy: q.Get("signed_copy"), Sort: q.Get("sort"), Dir: q.Get("dir"), Page: q.Get("page"), PageSize: q.Get("page_size"),
	}
	if v := q.Get("employee_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			writeError(w, r, errBadRequest)
			return
		}
		p.EmployeeID = &id
	}
	res, err := h.assets.List(r.Context(), p)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *assetHandler) summary(w http.ResponseWriter, r *http.Request) {
	s, err := h.assets.Summary(r.Context(), r.PathValue("kind"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// byNumber is ⌘K Search's filter: no match is 200 [].
func (h *assetHandler) byNumber(w http.ResponseWriter, r *http.Request) {
	vs, err := h.assets.ByNumber(r.Context(), r.PathValue("q"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, vs)
}

// byEmployee is a filter: an employee who never held an asset is 200 [].
func (h *assetHandler) byEmployee(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	hs, err := h.assets.ByEmployee(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, hs)
}

func (h *assetHandler) nextNumber(w http.ResponseWriter, r *http.Request) {
	n, err := h.assets.NextNumber(r.Context(), r.PathValue("prefix"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"inventory_no": n})
}

func (h *assetHandler) get(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	d, err := h.assets.Get(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (h *assetHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req createAssetRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	v, err := h.assets.Create(r.Context(), asset.CreateParams{Params: req.params(), Kind: req.Kind, ConnectionStatus: req.ConnectionStatus}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/assets/"+v.ID.String())
	writeJSON(w, http.StatusCreated, v)
}

// withAsset reads the actor, the asset id and the JSON body for a write.
func withAsset[T any](w http.ResponseWriter, r *http.Request) (actor, id uuid.UUID, body T, ok bool) {
	var err error
	if actor, err = actorID(r); err != nil {
		writeError(w, r, err)
		return
	}
	if id, err = parseUUIDPath(r, "id"); err != nil {
		writeError(w, r, err)
		return
	}
	if err = decodeJSON(w, r, &body); err != nil {
		writeError(w, r, err)
		return
	}
	return actor, id, body, true
}

func (h *assetHandler) update(w http.ResponseWriter, r *http.Request) {
	actor, id, req, ok := withAsset[assetParams](w, r)
	if !ok {
		return
	}
	v, err := h.assets.Update(r.Context(), id, req.params(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// changeStatus is Change Status: saved at once, no confirmation step (§5).
func (h *assetHandler) changeStatus(w http.ResponseWriter, r *http.Request) {
	actor, id, req, ok := withAsset[statusRequest](w, r)
	if !ok {
		return
	}
	v, err := h.assets.ChangeStatus(r.Context(), id, req.ConnectionStatus, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// preview is Preview Form and Print Form: the form Give would store, and its
// hash, without writing anything.
func (h *assetHandler) preview(w http.ResponseWriter, r *http.Request) {
	_, id, req, ok := withAsset[formRequest](w, r)
	if !ok {
		return
	}
	f, err := h.assets.Preview(r.Context(), id, req.params())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

// give is Give SIM Card and Give Asset.
func (h *assetHandler) give(w http.ResponseWriter, r *http.Request) {
	actor, id, req, ok := withAsset[giveRequest](w, r)
	if !ok {
		return
	}
	a, err := h.assets.Give(r.Context(), id, asset.GiveParams{
		FormParams: req.params(), Comment: req.Comment, PaperFormSigned: req.PaperFormSigned, FormHash: req.FormHash,
	}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, a)
}

// giveBack is Register SIM Return and Register Asset Return.
func (h *assetHandler) giveBack(w http.ResponseWriter, r *http.Request) {
	actor, id, req, ok := withAsset[returnRequest](w, r)
	if !ok {
		return
	}
	a, err := h.assets.Return(r.Context(), id, asset.ReturnParams{ReturnedDate: req.ReturnedDate, Comment: req.Comment}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (h *assetHandler) markNotReturned(w http.ResponseWriter, r *http.Request) {
	actor, id, req, ok := withAsset[notReturnedRequest](w, r)
	if !ok {
		return
	}
	a, err := h.assets.MarkNotReturned(r.Context(), id, asset.NotReturnedParams{Whereabouts: req.Whereabouts, Comment: req.Comment}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

// form is an assignment's stored form, for reprinting.
func (h *assetHandler) form(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	assignmentID, err := parseUUIDPath(r, "assignmentID")
	if err != nil {
		writeError(w, r, err)
		return
	}
	f, err := h.assets.Form(r.Context(), id, assignmentID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

// uploadSignedCopy takes a multipart form with one "file": the scan or photo of
// an assignment's signed form (§9). The body may be the file's 10 MB and a
// little for the form around it.
func (h *assetHandler) uploadSignedCopy(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	assignmentID, err := parseUUIDPath(r, "assignmentID")
	if err != nil {
		writeError(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, asset.MaxSignedCopyBytes+64<<10)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, r, asset.ErrFileTooLarge)
			return
		}
		writeErrorMessage(w, http.StatusBadRequest, "send the file as multipart/form-data, in a field named file")
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, header, err := r.FormFile("file")
	if err != nil {
		writeErrorMessage(w, http.StatusBadRequest, "send the file as multipart/form-data, in a field named file")
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, asset.MaxSignedCopyBytes+1))
	if err != nil {
		writeError(w, r, err)
		return
	}
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	c, err := h.assets.UploadSignedCopy(r.Context(), id, assignmentID, asset.Upload{FileName: header.Filename, Data: data}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

// signedCopy sends a signed copy as an attachment, never shown in the page:
// its type is the one checked on upload, and the browser may not guess another.
func (h *assetHandler) signedCopy(w http.ResponseWriter, r *http.Request) {
	ids := make([]uuid.UUID, 3)
	for i, name := range []string{"id", "assignmentID", "copyID"} {
		var err error
		if ids[i], err = parseUUIDPath(r, name); err != nil {
			writeError(w, r, err)
			return
		}
	}
	c, body, err := h.assets.SignedCopy(r.Context(), ids[0], ids[1], ids[2])
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer body.Close()
	hd := w.Header()
	hd.Set("Content-Type", c.ContentType)
	hd.Set("Content-Length", strconv.FormatInt(c.SizeBytes, 10))
	hd.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": c.FileName}))
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, body)
}
