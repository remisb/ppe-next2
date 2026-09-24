package main

import (
	"net/http"

	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/domain/user"
)

// Role groups used by route registrations.
var (
	// managers may manage items, prices and item sets ("Manage Items and Prices").
	managers = []string{user.RoleAdmin, user.RoleManager}
	admins   = []string{user.RoleAdmin}
)

// access is a route's authorization rule. roles nil with public false means
// any authenticated user.
type access struct {
	public bool
	roles  []string
}

type routeInfo struct {
	pattern string
	access  access
}

// router wraps ServeMux so every route is registered with an explicit access
// rule, and records the rules so tests can pin the whole policy.
type router struct {
	mux    *http.ServeMux
	authed middleware.Stack
	routes []routeInfo
}

func newRouter(verify middleware.TokenVerifier) *router {
	return &router{
		mux:    http.NewServeMux(),
		authed: middleware.NewStack(middleware.Authenticator(verify)),
	}
}

// public registers a route with no authentication.
func (rt *router) public(pattern string, h http.Handler) {
	rt.mux.Handle(pattern, h)
	rt.routes = append(rt.routes, routeInfo{pattern, access{public: true}})
}

// authenticated registers a route open to any signed-in user.
func (rt *router) authenticated(pattern string, h http.HandlerFunc) {
	rt.mux.Handle(pattern, rt.authed.ThenFunc(h))
	rt.routes = append(rt.routes, routeInfo{pattern, access{}})
}

// restricted registers a route open to users holding at least one of roles.
func (rt *router) restricted(pattern string, h http.HandlerFunc, roles ...string) {
	rt.mux.Handle(pattern, rt.authed.Append(middleware.Authorizer(roles...)).ThenFunc(h))
	rt.routes = append(rt.routes, routeInfo{pattern, access{roles: roles}})
}
