package main

import (
	"errors"
	"net/http"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/user"
)

type userHandler struct {
	users  *user.Service
	tokens *tokens
}

// registerUserRoutes mounts /api/v1/users.
//
//	any authenticated user   GET /me, PUT /me/password
//	users.read               GET list, by id, by email
//	users.manage             create, update, reset password, delete
//
// Managing users is sensitive (requireSensitive): it needs a recent sign-in,
// so a phone left signed in for weeks cannot be used to add an administrator
// or reset someone's password without the password, and the user's roles
// must still allow it. Changing one's own password asks for the current one
// anyway.
func registerUserRoutes(rt *router, users *user.Service, tok *tokens, sensitive func(role.Permission, http.HandlerFunc) http.HandlerFunc) {
	h := &userHandler{users: users, tokens: tok}

	rt.authenticated("GET /api/v1/users/me", h.me)
	rt.authenticated("PUT /api/v1/users/me/password", h.changeOwnPassword)
	rt.authenticated("PUT /api/v1/users/me/language", h.setOwnLanguage)

	rt.restricted("GET /api/v1/users", h.list, role.UsersRead)
	rt.restricted("GET /api/v1/users/{id}", h.get, role.UsersRead)
	rt.restricted("GET /api/v1/users/by-email/{email}", h.byEmail, role.UsersRead)

	rt.restricted("POST /api/v1/users", sensitive(role.UsersManage, h.create), role.UsersManage)
	rt.restricted("PUT /api/v1/users/{id}", sensitive(role.UsersManage, h.update), role.UsersManage)
	rt.restricted("PUT /api/v1/users/{id}/password", sensitive(role.UsersManage, h.setPassword), role.UsersManage)
	rt.restricted("DELETE /api/v1/users/{id}", sensitive(role.UsersManage, h.delete), role.UsersManage)
}

type createUserRequest struct {
	Email    string      `json:"email"`
	Name     string      `json:"name"`
	Password string      `json:"password"`
	RoleIDs  []uuid.UUID `json:"role_ids"`
}

type updateUserRequest struct {
	Email    string      `json:"email"`
	Name     string      `json:"name"`
	RoleIDs  []uuid.UUID `json:"role_ids"`
	IsActive *bool       `json:"is_active"`
}

type setPasswordRequest struct {
	Password string `json:"password"`
}

type languageRequest struct {
	Language string `json:"language"`
}

// setOwnLanguage sets the signed-in user's interface language and returns the user.
func (h *userHandler) setOwnLanguage(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req languageRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	u, err := h.users.SetLanguage(r.Context(), actor, req.Language)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (h *userHandler) me(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	u, err := h.users.Get(r.Context(), actor)
	if err != nil {
		// A valid token for a deleted user: the identity no longer exists.
		if errors.Is(err, user.ErrNotFound) {
			err = errUnauthenticated
		}
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// changeOwnPassword changes the signed-in user's password and signs them out
// on their other devices; this one stays signed in.
func (h *userHandler) changeOwnPassword(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	claims, err := h.tokens.bearer(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req changePasswordRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if err := h.users.ChangePassword(r.Context(), actor, claims.sessionID(), req.CurrentPassword, req.NewPassword); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *userHandler) list(w http.ResponseWriter, r *http.Request) {
	users, err := h.users.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (h *userHandler) get(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	u, err := h.users.Get(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// byEmail is a single-object lookup: email is unique among live users, so no
// match is a 404.
func (h *userHandler) byEmail(w http.ResponseWriter, r *http.Request) {
	u, err := h.users.ByEmail(r.Context(), r.PathValue("email"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (h *userHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req createUserRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	u, err := h.users.Create(r.Context(), user.CreateParams{
		Email: req.Email, Name: req.Name, Password: req.Password, RoleIDs: req.RoleIDs,
	}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/users/"+u.ID.String())
	writeJSON(w, http.StatusCreated, u)
}

func (h *userHandler) update(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req updateUserRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	// Update replaces all mutable fields, so is_active must be sent explicitly
	// rather than defaulting to false and deactivating the user by omission.
	active, err := requireBool(req.IsActive, "is_active", user.ErrInvalid)
	if err != nil {
		writeError(w, r, err)
		return
	}
	u, err := h.users.Update(r.Context(), id, user.UpdateParams{
		Email: req.Email, Name: req.Name, RoleIDs: req.RoleIDs, IsActive: active,
	}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (h *userHandler) setPassword(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req setPasswordRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if err := h.users.SetPassword(r.Context(), id, req.Password, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *userHandler) delete(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	if err := h.users.Delete(r.Context(), id, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
