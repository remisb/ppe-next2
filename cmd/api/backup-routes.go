package main

import (
	"net/http"

	"github.com/remisb/ppe-next2/internal/domain/backup"
)

// registerBackupRoutes mounts the backup report: when the database was last
// backed up, the recent runs, and whether a backup is overdue or failed. It
// only reads what the backup agent records; administrators only.
func registerBackupRoutes(rt *router, svc *backup.Service) {
	rt.restricted("GET /api/v1/backups", func(w http.ResponseWriter, r *http.Request) {
		st, err := svc.Status(r.Context())
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, st)
	}, admins...)
}
