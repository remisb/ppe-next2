package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/catalogue"
	"github.com/remisb/ppe-next2/internal/domain/dashboard"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/itemset"
	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/domain/user"
)

const maxBodyBytes = 1 << 20

var (
	errBadRequest      = errors.New("malformed request")
	errUnauthenticated = errors.New("unauthenticated")
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

// errorStatuses maps every domain sentinel to its status. Checked in order with
// errors.Is; each domain adds its sentinels here.
var errorStatuses = []struct {
	err    error
	status int
}{
	{errBadRequest, http.StatusBadRequest},

	// The actor comes from a verified token, so an unknown actor is an
	// authentication problem, not a bad request.
	{errUnauthenticated, http.StatusUnauthorized},
	{user.ErrInvalidCredentials, http.StatusUnauthorized},
	{user.ErrActorNotFound, http.StatusUnauthorized},
	{employee.ErrActorNotFound, http.StatusUnauthorized},
	{catalogue.ErrActorNotFound, http.StatusUnauthorized},
	{itemset.ErrActorNotFound, http.StatusUnauthorized},
	{order.ErrActorNotFound, http.StatusUnauthorized},

	{user.ErrNotFound, http.StatusNotFound},
	{employee.ErrNotFound, http.StatusNotFound},
	{catalogue.ErrNotFound, http.StatusNotFound},
	{itemset.ErrNotFound, http.StatusNotFound},
	{order.ErrNotFound, http.StatusNotFound},
	{order.ErrEmployeeNotFound, http.StatusNotFound},
	{order.ErrItemSetNotFound, http.StatusNotFound},

	{user.ErrEmailTaken, http.StatusConflict},
	{employee.ErrCodeTaken, http.StatusConflict},
	{catalogue.ErrNameTaken, http.StatusConflict},
	{itemset.ErrNameTaken, http.StatusConflict},
	{order.ErrPriceMissing, http.StatusConflict},
	{order.ErrItemUnavailable, http.StatusConflict},
	{order.ErrNotOrdered, http.StatusConflict},
	{order.ErrLinkExpired, http.StatusGone},

	{user.ErrInvalid, http.StatusBadRequest},
	{employee.ErrInvalid, http.StatusBadRequest},
	{catalogue.ErrInvalid, http.StatusBadRequest},
	{itemset.ErrInvalid, http.StatusBadRequest},
	{itemset.ErrUnknownItem, http.StatusBadRequest},
	{order.ErrInvalid, http.StatusBadRequest},
	{dashboard.ErrInvalid, http.StatusBadRequest},
}

// writeError is the only place errors become status codes. Unauthenticated
// responses get a fixed message; anything unrecognised is logged and returned
// as an opaque 500 so storage details never reach the client.
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	for _, m := range errorStatuses {
		if errors.Is(err, m.err) {
			msg := err.Error()
			if m.status == http.StatusUnauthorized {
				msg = "unauthenticated"
			}
			writeErrorMessage(w, m.status, msg)
			return
		}
	}
	slog.ErrorContext(r.Context(), "request failed",
		slog.String("method", r.Method), slog.String("path", r.URL.Path), slog.Any("error", err))
	writeErrorMessage(w, http.StatusInternalServerError, "internal error")
}

// parseUUIDPath reads path wildcard key as a UUID; a malformed one is a 400.
func parseUUIDPath(r *http.Request, key string) (uuid.UUID, error) {
	id, err := uuid.Parse(r.PathValue(key))
	if err != nil {
		return uuid.Nil, errBadRequest
	}
	return id, nil
}

// requireBool reads a required boolean field. Full-replace updates must not
// turn an omitted flag into false.
func requireBool(v *bool, field string, invalid error) (bool, error) {
	if v == nil {
		return false, fmt.Errorf("%w: %s is required", invalid, field)
	}
	return *v, nil
}
