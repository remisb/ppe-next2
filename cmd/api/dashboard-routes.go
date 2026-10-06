package main

import (
	"net/http"

	"github.com/remisb/ppe-next2/internal/domain/dashboard"
	"github.com/remisb/ppe-next2/internal/domain/role"
)

// registerDashboardRoutes mounts the dashboards. Each only reads, and each has
// its own permission, which only its built-in role holds: the administrator's
// (the Dashboard) summarises spending and every employee, the manager's items,
// prices and purchasing, and the employee role's the signed-in user's own
// orders and what to order next.
func registerDashboardRoutes(rt *router, svc *dashboard.Service) {
	rt.restricted("GET /api/v1/dashboard", func(w http.ResponseWriter, r *http.Request) {
		o, err := svc.Overview(r.Context())
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, o)
	}, role.DashboardOverview)
	rt.restricted("GET /api/v1/dashboard/manager", func(w http.ResponseWriter, r *http.Request) {
		o, err := svc.Manager(r.Context())
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, o)
	}, role.DashboardManager)
	rt.restricted("GET /api/v1/dashboard/employee", func(w http.ResponseWriter, r *http.Request) {
		me, err := actorID(r)
		if err != nil {
			writeError(w, r, err)
			return
		}
		o, err := svc.Employee(r.Context(), me)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, o)
	}, role.DashboardEmployee)
	// The Replacements due screen: the whole list the dashboards show the start
	// of. Any signed-in user, like History, which holds the same orders.
	rt.authenticated("GET /api/v1/replacements", func(w http.ResponseWriter, r *http.Request) {
		o, err := svc.Replacements(r.Context())
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, o)
	})
}
