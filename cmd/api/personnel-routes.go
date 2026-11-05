package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/personnel/document"
)

// Personnel files' identity documents (ADR 0007, docs/specs/personnel-service.md):
// docs-import checks and saves them; the employee page reads their summary, and
// everyone its "valid until" line. Nothing read from a document is ever in a
// URL, a log line or an error.
type personnelHandler struct {
	documents *document.Service
}

func registerPersonnelRoutes(rt *router, documents *document.Service) {
	h := &personnelHandler{documents: documents}
	rt.restricted("POST /api/v1/personnel/documents/check", h.check, role.PersonnelDocumentsManage)
	rt.restricted("POST /api/v1/personnel/documents", h.save, role.PersonnelDocumentsManage)
	rt.restricted("GET /api/v1/personnel/documents/by-employee/{id}", h.documentsOf, role.PersonnelDocumentsRead)
	rt.authenticated("GET /api/v1/personnel/documents/by-employee/{id}/validity", h.validity)
}

type checkRequest struct {
	EmployeeID *uuid.UUID `json:"employee_id"`
	MRZ        []string   `json:"mrz"`
	Surname    string     `json:"surname"`
	GivenNames string     `json:"given_names"`
}

func (h *personnelHandler) check(w http.ResponseWriter, r *http.Request) {
	var req checkRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	p := document.CheckParams{MRZ: req.MRZ, Surname: req.Surname, GivenNames: req.GivenNames}
	if req.EmployeeID != nil {
		p.EmployeeID = *req.EmployeeID
	}
	res, err := h.documents.Check(r.Context(), p)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeNoStore(w)
	writeJSON(w, http.StatusOK, res)
}

// saveRequest is Save's "document" part.
type saveRequest struct {
	Employee struct {
		ID  *uuid.UUID `json:"id"`
		New *struct {
			FirstName string  `json:"first_name"`
			LastName  string  `json:"last_name"`
			Code      *string `json:"code"`
		} `json:"new"`
	} `json:"employee"`
	MRZ                 []string        `json:"mrz"`
	Kind                document.Kind   `json:"kind"`
	Surname             string          `json:"surname"`
	GivenNames          string          `json:"given_names"`
	IssuedOn            string          `json:"issued_on"`
	PlaceOfBirth        string          `json:"place_of_birth"`
	Authority           string          `json:"authority"`
	AddToEmployeeRecord bool            `json:"add_to_employee_record"`
	Take                []document.Take `json:"take"`
}

// copyParts are the multipart parts that carry a Document Copy, by side.
var copyParts = map[string]document.Side{
	"copy_page": document.SidePage, "copy_front": document.SideFront,
	"copy_back": document.SideBack, "portrait": document.SidePortrait,
}

// saveLimit is the most a Save may send: four copies of 5 MB and the JSON.
const saveLimit = 4*(5<<20) + 256<<10

const saveShape = `send multipart/form-data with a "document" part (JSON) and the copies as copy_page, copy_front, copy_back and portrait`

// save takes the reviewed document as multipart/form-data: the "document"
// part (JSON) and each copy as a file part (FR-10).
func (h *personnelHandler) save(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, saveLimit)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, r, document.ErrCopyTooLarge)
			return
		}
		writeErrorMessage(w, http.StatusBadRequest, saveShape)
		return
	}
	defer r.MultipartForm.RemoveAll()
	var req saveRequest
	body := r.MultipartForm.Value["document"]
	if len(body) != 1 {
		writeErrorMessage(w, http.StatusBadRequest, saveShape)
		return
	}
	dec := json.NewDecoder(strings.NewReader(body[0]))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, r, errBadRequest)
		return
	}
	p := document.SaveParams{
		MRZ: req.MRZ, Kind: req.Kind, Surname: req.Surname, GivenNames: req.GivenNames, IssuedOn: req.IssuedOn,
		PlaceOfBirth: req.PlaceOfBirth, Authority: req.Authority, AddToEmployeeRecord: req.AddToEmployeeRecord,
		Take: req.Take, Copies: map[document.Side][]byte{},
	}
	if req.Employee.ID != nil {
		p.EmployeeID = *req.Employee.ID
	}
	if n := req.Employee.New; n != nil {
		p.New = &document.NewEmployee{FirstName: n.FirstName, LastName: n.LastName, Code: n.Code}
	}
	for name, files := range r.MultipartForm.File {
		side, ok := copyParts[name]
		if !ok || len(files) != 1 {
			writeErrorMessage(w, http.StatusBadRequest, saveShape)
			return
		}
		f, err := files[0].Open()
		if err != nil {
			writeError(w, r, err)
			return
		}
		data, err := io.ReadAll(io.LimitReader(f, 5<<20+1))
		f.Close()
		if err != nil {
			writeError(w, r, err)
			return
		}
		p.Copies[side] = data
	}
	doc, err := h.documents.Save(r.Context(), p, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, doc)
}

func (h *personnelHandler) documentsOf(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	docs, err := h.documents.Documents(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeNoStore(w)
	writeJSON(w, http.StatusOK, docs)
}

func (h *personnelHandler) validity(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	v, err := h.documents.Validity(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// writeNoStore keeps an answer about a person's documents out of every cache.
func writeNoStore(w http.ResponseWriter) { w.Header().Set("Cache-Control", "no-store") }
