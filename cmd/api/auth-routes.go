package main

import (
	"net/http"
	"time"

	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/domain/user"
)

type authHandler struct {
	users  *user.Service
	tokens *tokens
}

// registerAuthRoutes mounts the only unauthenticated API route: login. It is
// rate-limited per client address (middleware.ClientAddr, resolved by the
// global ClientIP middleware) to slow password guessing. The email is not
// part of the key: keying on it would let one address spread guesses across
// many accounts unthrottled.
func registerAuthRoutes(rt *router, users *user.Service, tokens *tokens, limit int, interval time.Duration) {
	h := &authHandler{users: users, tokens: tokens}
	limiter := middleware.RateLimiter(middleware.RateLimitConfig{
		RequestsPerInterval: limit,
		Interval:            interval,
		KeyFunc:             middleware.ClientAddr,
	})
	rt.public("POST /api/v1/auth/login", middleware.Chain(http.HandlerFunc(h.login), limiter))
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResponse struct {
	AccessToken string    `json:"access_token"`
	TokenType   string    `json:"token_type"`
	ExpiresIn   int64     `json:"expires_in"`
	ExpiresAt   time.Time `json:"expires_at"`
	User        user.User `json:"user"`
}

func (h *authHandler) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	u, err := h.users.Authenticate(r.Context(), req.Email, req.Password)
	if err != nil {
		writeError(w, r, err)
		return
	}
	token, exp, err := h.tokens.issue(u)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, loginResponse{
		AccessToken: token,
		TokenType:   "Bearer",
		ExpiresIn:   int64(time.Until(exp).Seconds()),
		ExpiresAt:   exp.UTC(),
		User:        u,
	})
}
