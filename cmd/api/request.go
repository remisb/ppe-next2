package main

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/launcher"
)

// appHeader names the app a request comes from; @ppe/api-client sends it.
const appHeader = "X-PPE-App"

// appVersionHeader names the build of a published app (/apps/<slug>/) that sent the request.
const appVersionHeader = "X-PPE-App-Version"

// requestContext gives every request an ID, returned as X-Request-ID, and puts
// the audit.Request on its context: that ID, the sign-in its access token
// belongs to, and where it comes from. audit.Insert records them with every
// change the request makes; the domain services never read them. The user,
// address and browser are there for the security log (internal/security).
//
// The ID is always made here: one sent by the client could be chosen to
// collide with another request's.
//
// isApp tells a registered app's slug (App Launcher's registry) from anything
// else a client might send as X-PPE-App.
func requestContext(tok *tokens, isApp func(slug string) bool) middleware.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			req := audit.Request{
				ID: uuid.NewString(), Source: requestSource(r, isApp),
				IP: middleware.ClientAddr(r), UserAgent: r.UserAgent(),
			}
			// A published app's build, when the header is a version's name.
			if v := r.Header.Get(appVersionHeader); req.Source != audit.SourceAPI && launcher.ValidVersion(v) {
				req.AppVersion = v
			}
			// A token that does not verify names no sign-in; its request is
			// refused by Authenticator before it could change anything.
			if claims, err := tok.bearer(r); err == nil {
				req.SessionID = claims.sessionID()
				req.UserID, _ = uuid.Parse(claims.Subject)
			}
			w.Header().Set("X-Request-ID", req.ID)
			next.ServeHTTP(w, r.WithContext(audit.WithRequest(r.Context(), req)))
		})
	}
}

// requestSource is where a request comes from: a public confirmation link,
// an app by its slug (appHeader: the staff app, Administration, App Launcher
// or an app registered in App Launcher), or any other API client.
func requestSource(r *http.Request, isApp func(slug string) bool) audit.Source {
	if strings.HasPrefix(r.URL.Path, "/api/v1/confirmations/") {
		return audit.SourcePublicLink
	}
	switch app := r.Header.Get(appHeader); {
	case app == "workwear":
		return audit.SourceWorkwear
	case app == "admin":
		return audit.SourceAdmin
	case app == "launcher" || (app != "" && isApp(app)):
		return audit.Source(app)
	}
	return audit.SourceAPI
}
