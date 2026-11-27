package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/apperr"
	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/personnel/mrz"
)

const maxBodyBytes = 1 << 20

var (
	errBadRequest      = apperr.New(apperr.BadRequest, "request.bad", "malformed request")
	errUnauthenticated = apperr.New(apperr.Unauthenticated, "auth.unauthenticated", "unauthenticated")
)

// decodeJSON reads one JSON object into dst. Unknown fields are rejected so a
// client cannot set id, timestamps or actor columns by sending them.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return errBadRequest
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errBadRequest
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeErrorMessage(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// kindStatuses maps each error kind (internal/apperr) to its status. Every
// sentinel a domain answers is declared with apperr.New and one kind, so a new
// sentinel needs no entry here. Checked in order with errors.Is: a chain holding
// two kinded errors answers the first kind listed.
var kindStatuses = []struct {
	kind   error
	status int
}{
	{apperr.Forbidden, http.StatusForbidden},
	// The actor comes from a verified token, so an unknown actor is an
	// authentication problem, not a bad request: every ErrActorNotFound is
	// apperr.Unauthenticated.
	{apperr.Unauthenticated, http.StatusUnauthorized},
	{apperr.NotFound, http.StatusNotFound},
	{apperr.TooLarge, http.StatusRequestEntityTooLarge},
	{apperr.UnsupportedType, http.StatusUnsupportedMediaType},
	{apperr.Unavailable, http.StatusServiceUnavailable},
	{apperr.Conflict, http.StatusConflict},
	{apperr.Gone, http.StatusGone},
	{apperr.Unprocessable, http.StatusUnprocessableEntity},
	{apperr.TooMany, http.StatusTooManyRequests},
	{apperr.Invalid, http.StatusBadRequest},
	{apperr.BadRequest, http.StatusBadRequest},
}

// writeError is the only place errors become status codes. Unauthenticated
// responses get a fixed message; anything unrecognised is logged and returned
// as an opaque 500 so storage details never reach the client.
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	for _, m := range kindStatuses {
		if errors.Is(err, m.kind) {
			body := errorBody{Error: err.Error(), Code: apperr.CodeOf(err)}
			if m.status == http.StatusUnauthorized {
				// Which check failed is not the caller's to know.
				body = errorBody{Error: "unauthenticated"}
			}
			// A conflict with an existing record names it, so the app can open it.
			var existing interface{ ExistingID() uuid.UUID }
			if errors.As(err, &existing) {
				body.ExistingID = existing.ExistingID().String()
			}
			// A duplicate identity document says which kind; an MRZ the API
			// refuses lists its problems as codes, never what was read.
			var conflict interface{ Conflict() string }
			if errors.As(err, &conflict) {
				body.Conflict = conflict.Conflict()
			}
			var problems interface{ MRZProblems() []mrz.Issue }
			if errors.As(err, &problems) {
				body.Problems = problems.MRZProblems()
			}
			// A refused row of a batch is named by its index.
			var row interface{ RowIndex() int }
			if errors.As(err, &row) {
				i := row.RowIndex()
				body.Index = &i
			}
			writeJSON(w, m.status, body)
			return
		}
	}
	// The client went away while the request was handled: nothing failed.
	if errors.Is(err, context.Canceled) && r.Context().Err() != nil {
		writeErrorMessage(w, statusClientClosed, "request cancelled")
		return
	}
	slog.ErrorContext(r.Context(), "request failed",
		slog.String("method", r.Method), slog.String("path", r.URL.Path), slog.Any("error", err))
	failed(r, err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal error", Reference: audit.RequestFrom(r.Context()).ID})
}

// errorBody is an error answer. Reference, on a 500, is the request's ID: the
// app shows it for a person to quote, and it finds the error on System's list
// and the request's log lines.
type errorBody struct {
	Error string `json:"error"`
	// Code is the error's stable name (apperr's, such as "supplier.code_taken"),
	// for an app to tell refusals apart without reading the message. A 401 and
	// a 500 have none.
	Code      string `json:"code,omitempty"`
	Reference string `json:"reference,omitempty"`
	// ExistingID is the record a conflict is with: the asset that already
	// has the SIM or inventory number.
	ExistingID string `json:"existing_id,omitempty"`
	// Index is the refused row of a batch (Scan SIMs), counted from 0.
	Index *int `json:"index,omitempty"`
	// Conflict is which duplicate an identity document is (document_on_file,
	// other_employee); Problems are an MRZ's, as codes and fields.
	Conflict string      `json:"conflict,omitempty"`
	Problems []mrz.Issue `json:"problems,omitempty"`
}

// parseUUIDPath reads path wildcard key as a UUID; a malformed one is a 400.
func parseUUIDPath(r *http.Request, key string) (uuid.UUID, error) {
	id, err := uuid.Parse(r.PathValue(key))
	if err != nil {
		return uuid.Nil, errBadRequest
	}
	return id, nil
}

// actorOf is the signed-in actor, answering the error itself.
func actorOf(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return uuid.Nil, false
	}
	return actor, true
}

// idAndActor reads the path's id and the signed-in actor, answering the error itself.
func idAndActor(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return uuid.Nil, uuid.Nil, false
	}
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return uuid.Nil, uuid.Nil, false
	}
	return id, actor, true
}

// parseMultipart reads a multipart/form-data body of at most bodyLimit bytes,
// keeping 1 MiB of it in memory. A larger body answers tooLarge, any other
// failure 400 with shape, which says what the route expects. The caller
// removes the form's files: defer r.MultipartForm.RemoveAll().
func parseMultipart(w http.ResponseWriter, r *http.Request, bodyLimit int64, tooLarge error, shape string) bool {
	r.Body = http.MaxBytesReader(w, r.Body, bodyLimit)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, r, tooLarge)
			return false
		}
		writeErrorMessage(w, http.StatusBadRequest, shape)
		return false
	}
	return true
}

// formFile reads the parsed form's file part named field, at most limit+1
// bytes so that the domain refuses a larger file, and its file name. A missing
// part answers 400 with shape.
func formFile(w http.ResponseWriter, r *http.Request, field string, limit int64, shape string) ([]byte, string, bool) {
	f, header, err := r.FormFile(field)
	if err != nil {
		writeErrorMessage(w, http.StatusBadRequest, shape)
		return nil, "", false
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		writeError(w, r, err)
		return nil, "", false
	}
	return data, header.Filename, true
}

// requireBool reads a required boolean field. Full-replace updates must not
// turn an omitted flag into false.
func requireBool(v *bool, field string, invalid error) (bool, error) {
	if v == nil {
		return false, fmt.Errorf("%w: %s is required", invalid, field)
	}
	return *v, nil
}
