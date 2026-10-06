package main

import (
	"net/http"

	"github.com/remisb/ppe-next2/internal/domain/role"
)

type roleHandler struct {
	roles *role.Service
}

// registerRoleRoutes mounts the permission catalogue and /api/v1/roles.
//
//	users.read     GET /permissions, GET /roles, GET /roles/{id}
//	roles.manage   POST /roles, PUT /roles/{id}, DELETE /roles/{id}
//
// Managing roles is sensitive, as managing users is (requireSensitive).
// Whoever reads users reads roles too, to name what each user holds.
func registerRoleRoutes(rt *router, roles *role.Service, sensitive func(role.Permission, http.HandlerFunc) http.HandlerFunc) {
	h := &roleHandler{roles: roles}
	rt.restricted("GET /api/v1/permissions", h.permissions, role.UsersRead)
	rt.restricted("GET /api/v1/roles", h.list, role.UsersRead)
	rt.restricted("GET /api/v1/roles/{id}", h.get, role.UsersRead)
	rt.restricted("POST /api/v1/roles", sensitive(role.RolesManage, h.create), role.RolesManage)
	rt.restricted("PUT /api/v1/roles/{id}", sensitive(role.RolesManage, h.update), role.RolesManage)
	rt.restricted("DELETE /api/v1/roles/{id}", sensitive(role.RolesManage, h.delete), role.RolesManage)
}

// roleRequest is a role's client-settable fields; id, key, locked, user_count,
// timestamps and actors are refused (decodeJSON disallows unknown fields).
type roleRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
}

func (req roleRequest) params() role.Params {
	return role.Params{Name: req.Name, Description: req.Description, Permissions: req.Permissions}
}

func (h *roleHandler) permissions(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, role.Catalogue())
}

func (h *roleHandler) list(w http.ResponseWriter, r *http.Request) {
	roles, err := h.roles.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, roles)
}

func (h *roleHandler) get(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	got, err := h.roles.Get(r.Context(), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, got)
}

func (h *roleHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req roleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	created, err := h.roles.Create(r.Context(), req.params(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/roles/"+created.ID.String())
	writeJSON(w, http.StatusCreated, created)
}

func (h *roleHandler) update(w http.ResponseWriter, r *http.Request) {
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
	var req roleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	updated, err := h.roles.Update(r.Context(), id, req.params(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *roleHandler) delete(w http.ResponseWriter, r *http.Request) {
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
	if err := h.roles.Delete(r.Context(), id, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
