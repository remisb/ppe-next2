package main

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/audit"
)

// appHeader names the app a request comes from; @ppe/api-client sends it.
const appHeader = "X-PPE-App"

// requestContext gives every request an ID, returned as X-Request-ID, and puts
// the audit.Request on its context: that ID, the sign-in its access token
// belongs to, and where it comes from. audit.Insert records them with every
// change the request makes; the domain services never read them. The user,
// address and browser are there for the security log (internal/security).
//
// The ID is always made here: one sent by the client could be chosen to
// collide with another request's.
func requestContext(tok *tokens) middleware.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			req := audit.Request{
				ID: uuid.NewString(), Source: requestSource(r),
				IP: middleware.ClientAddr(r), UserAgent: r.UserAgent(),
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
// one of the two apps (by appHeader), or any other API client.
func requestSource(r *http.Request) audit.Source {
	if strings.HasPrefix(r.URL.Path, "/api/v1/confirmations/") {
		return audit.SourcePublicLink
	}
	switch r.Header.Get(appHeader) {
	case "workwear":
		return audit.SourceWorkwear
	case "admin":
		return audit.SourceAdmin
	}
	return audit.SourceAPI
}
