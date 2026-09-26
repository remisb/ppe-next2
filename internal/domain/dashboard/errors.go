package dashboard

import "errors"

// ErrInvalid is returned for a request the dashboards cannot answer, such as
// a missing user.
var ErrInvalid = errors.New("dashboard: invalid request")
