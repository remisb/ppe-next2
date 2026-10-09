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

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/asset"
	"github.com/remisb/ppe-next2/internal/domain/catalogue"
	"github.com/remisb/ppe-next2/internal/domain/dashboard"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/itemset"
	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/session"
	"github.com/remisb/ppe-next2/internal/domain/settings"
	"github.com/remisb/ppe-next2/internal/domain/user"
	"github.com/remisb/ppe-next2/internal/security"
	"github.com/remisb/ppe-next2/internal/system"
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
	{errTooManyAttempts, http.StatusTooManyRequests},
	{errCrossOrigin, http.StatusForbidden},
	{errRecentSignInRequired, http.StatusForbidden},
	{errPermissionWithdrawn, http.StatusForbidden},
	{user.ErrNotPermitted, http.StatusForbidden},
	{role.ErrNotPermitted, http.StatusForbidden},

	// The actor comes from a verified token, so an unknown actor is an
	// authentication problem, not a bad request.
	{errUnauthenticated, http.StatusUnauthorized},
	{user.ErrInvalidCredentials, http.StatusUnauthorized},
	{user.ErrActorNotFound, http.StatusUnauthorized},
	{session.ErrInvalidToken, http.StatusUnauthorized},
	{employee.ErrActorNotFound, http.StatusUnauthorized},
	{catalogue.ErrActorNotFound, http.StatusUnauthorized},
	{itemset.ErrActorNotFound, http.StatusUnauthorized},
	{order.ErrActorNotFound, http.StatusUnauthorized},
	{settings.ErrActorNotFound, http.StatusUnauthorized},
	{role.ErrActorNotFound, http.StatusUnauthorized},
	{asset.ErrActorNotFound, http.StatusUnauthorized},

	{user.ErrNotFound, http.StatusNotFound},
	{role.ErrNotFound, http.StatusNotFound},
	{session.ErrNotFound, http.StatusNotFound},
	{employee.ErrNotFound, http.StatusNotFound},
	{catalogue.ErrNotFound, http.StatusNotFound},
	{itemset.ErrNotFound, http.StatusNotFound},
	{order.ErrNotFound, http.StatusNotFound},
	{order.ErrEmployeeNotFound, http.StatusNotFound},
	{order.ErrItemSetNotFound, http.StatusNotFound},
	{audit.ErrNotFound, http.StatusNotFound},
	{security.ErrNotFound, http.StatusNotFound},
	{asset.ErrNotFound, http.StatusNotFound},
	{asset.ErrEmployeeNotFound, http.StatusNotFound},
	{asset.ErrNoForm, http.StatusNotFound},

	{user.ErrEmailTaken, http.StatusConflict},
	{user.ErrLastAdministrator, http.StatusConflict},
	{role.ErrNameTaken, http.StatusConflict},
	{role.ErrInUse, http.StatusConflict},
	{role.ErrBuiltIn, http.StatusConflict},
	{employee.ErrCodeTaken, http.StatusConflict},
	{catalogue.ErrNameTaken, http.StatusConflict},
	{itemset.ErrNameTaken, http.StatusConflict},
	{order.ErrPriceMissing, http.StatusConflict},
	{order.ErrItemUnavailable, http.StatusConflict},
	{order.ErrNotOrdered, http.StatusConflict},
	{employee.ErrHoldsAssets, http.StatusConflict},
	{asset.ErrInventoryNoTaken, http.StatusConflict},
	{asset.ErrSIMNoTaken, http.StatusConflict},
	{asset.ErrAlreadyGiven, http.StatusConflict},
	{asset.ErrNotActive, http.StatusConflict},
	{asset.ErrNotGiven, http.StatusConflict},
	{asset.ErrAlreadyMarked, http.StatusConflict},
	{asset.ErrFormChanged, http.StatusConflict},
	{order.ErrLinkExpired, http.StatusGone},

	{user.ErrInvalid, http.StatusBadRequest},
	{role.ErrInvalid, http.StatusBadRequest},
	{session.ErrInvalid, http.StatusBadRequest},
	{employee.ErrInvalid, http.StatusBadRequest},
	{catalogue.ErrInvalid, http.StatusBadRequest},
	{itemset.ErrInvalid, http.StatusBadRequest},
	{itemset.ErrUnknownItem, http.StatusBadRequest},
	{order.ErrInvalid, http.StatusBadRequest},
	{dashboard.ErrInvalid, http.StatusBadRequest},
	{settings.ErrInvalid, http.StatusBadRequest},
	{audit.ErrInvalid, http.StatusBadRequest},
	{security.ErrInvalid, http.StatusBadRequest},
	{asset.ErrInvalid, http.StatusBadRequest},
	{system.ErrNotFound, http.StatusNotFound},
	{system.ErrInvalid, http.StatusBadRequest},
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
			// A conflict with an existing record names it, so the app can open it.
			var existing interface{ ExistingID() uuid.UUID }
			if errors.As(err, &existing) {
				writeJSON(w, m.status, errorBody{Error: msg, ExistingID: existing.ExistingID().String()})
				return
			}
			writeErrorMessage(w, m.status, msg)
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
	Error     string `json:"error"`
	Reference string `json:"reference,omitempty"`
	// ExistingID is the record a conflict is with: the asset that already
	// has the SIM or inventory number.
	ExistingID string `json:"existing_id,omitempty"`
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
