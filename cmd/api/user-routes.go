package main

import (
	"errors"
	"net/http"

	"github.com/remisb/ppe-next2/internal/domain/user"
)

type userHandler struct {
	users *user.Service
}

// registerUserRoutes mounts /api/v1/users.
//
//	any authenticated user   GET /me, PUT /me/password
//	admin, manager           GET list, by id, by email
//	admin                    create, update, reset password, delete
func registerUserRoutes(rt *router, users *user.Service) {
	h := &userHandler{users: users}

	rt.authenticated("GET /api/v1/users/me", h.me)
	rt.authenticated("PUT /api/v1/users/me/password", h.changeOwnPassword)

	rt.restricted("GET /api/v1/users", h.list, managers...)
	rt.restricted("GET /api/v1/users/{id}", h.get, managers...)
	rt.restricted("GET /api/v1/users/by-email/{email}", h.byEmail, managers...)

	rt.restricted("POST /api/v1/users", h.create, admins...)
	rt.restricted("PUT /api/v1/users/{id}", h.update, admins...)
	rt.restricted("PUT /api/v1/users/{id}/password", h.setPassword, admins...)
	rt.restricted("DELETE /api/v1/users/{id}", h.delete, admins...)
}

type createUserRequest struct {
	Email    string   `json:"email"`
	Name     string   `json:"name"`
	Password string   `json:"password"`
	Roles    []string `json:"roles"`
}

type updateUserRequest struct {
	Email    string   `json:"email"`
	Name     string   `json:"name"`
	Roles    []string `json:"roles"`
	IsActive *bool    `json:"is_active"`
}

type setPasswordRequest struct {
	Password string `json:"password"`
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

func (h *userHandler) changeOwnPassword(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req changePasswordRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if err := h.users.ChangePassword(r.Context(), actor, req.CurrentPassword, req.NewPassword); err != nil {
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
		Email: req.Email, Name: req.Name, Password: req.Password, Roles: req.Roles,
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
		Email: req.Email, Name: req.Name, Roles: req.Roles, IsActive: active,
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
