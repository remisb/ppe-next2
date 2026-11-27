package dashboard

import (
	"github.com/remisb/ppe-next2/internal/apperr"
)

// ErrInvalid is returned for a request the dashboards cannot answer, such as
// a missing user.
var ErrInvalid = apperr.New(apperr.Invalid, "dashboard.invalid", "dashboard: invalid request")
