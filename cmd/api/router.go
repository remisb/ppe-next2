package main

import (
	"net/http"

	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/domain/role"
)

// access is a route's authorization rule. perm empty with public false means
// any authenticated user.
type access struct {
	public bool
	perm   role.Permission
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

// named notes the route's pattern for observe before anything else runs, so
// a request that times out or panics is counted under its route.
func named(pattern string, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		stateFrom(r.Context()).set(func(st *requestState) { st.route = pattern })
		h.ServeHTTP(w, r)
	})
}

// public registers a route with no authentication.
func (rt *router) public(pattern string, h http.Handler) {
	rt.mux.Handle(pattern, named(pattern, h))
	rt.routes = append(rt.routes, routeInfo{pattern, access{public: true}})
}

// authenticated registers a route open to any signed-in user.
func (rt *router) authenticated(pattern string, h http.HandlerFunc) {
	rt.mux.Handle(pattern, named(pattern, rt.authed.ThenFunc(h)))
	rt.routes = append(rt.routes, routeInfo{pattern, access{}})
}

// restricted registers a route open to users whose token grants perm.
func (rt *router) restricted(pattern string, h http.HandlerFunc, perm role.Permission) {
	rt.mux.Handle(pattern, named(pattern, rt.authed.Append(middleware.Authorizer(string(perm))).ThenFunc(h)))
	rt.routes = append(rt.routes, routeInfo{pattern, access{perm: perm}})
}
