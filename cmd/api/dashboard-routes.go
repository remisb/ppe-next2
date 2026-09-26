package main

import (
	"net/http"

	"github.com/remisb/ppe-next2/internal/domain/dashboard"
)

// registerDashboardRoutes mounts the dashboards. Each only reads, and each is
// for its role alone: the administrator's summarises spending and every
// employee, the manager's items, prices and purchasing.
func registerDashboardRoutes(rt *router, svc *dashboard.Service) {
	rt.restricted("GET /api/v1/dashboard", func(w http.ResponseWriter, r *http.Request) {
		o, err := svc.Overview(r.Context())
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, o)
	}, admins...)
	rt.restricted("GET /api/v1/dashboard/manager", func(w http.ResponseWriter, r *http.Request) {
		o, err := svc.Manager(r.Context())
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, o)
	}, managerRole...)
}
