package main

import (
	"net/http"

	"github.com/remisb/ppe-next2/internal/domain/dashboard"
)

// registerDashboardRoutes mounts the administrator's dashboard. It only reads,
// but it summarises spending and every employee, so it is admins only.
func registerDashboardRoutes(rt *router, svc *dashboard.Service) {
	rt.restricted("GET /api/v1/dashboard", func(w http.ResponseWriter, r *http.Request) {
		o, err := svc.Overview(r.Context())
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, o)
	}, admins...)
}
