package main

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/domain/user"
)

type authHandler struct {
	users  *user.Service
	tokens *tokens
	emails *emailLimiter
}

// registerAuthRoutes mounts the only unauthenticated API route: login. Two
// limits slow password guessing. Every attempt counts against the client
// address (middleware.ClientAddr, resolved by the global ClientIP middleware),
// which stops one address spreading guesses across many accounts. Failed
// attempts also count against the email (emailLimiter), which stops many
// addresses guessing at one account. A config without the per-email limit
// (LoginEmailFailures 0, as in tests that build one by hand) leaves it off.
func registerAuthRoutes(rt *router, users *user.Service, tokens *tokens, cfg config) {
	h := &authHandler{users: users, tokens: tokens}
	if cfg.LoginEmailFailures > 0 {
		h.emails = newEmailLimiter(cfg.LoginEmailFailures, cfg.LoginEmailInterval)
	}
	limiter := middleware.RateLimiter(middleware.RateLimitConfig{
		RequestsPerInterval: cfg.LoginRateLimit,
		Interval:            cfg.LoginRateInterval,
		KeyFunc:             middleware.ClientAddr,
	})
	rt.public("POST /api/v1/auth/login", middleware.Chain(http.HandlerFunc(h.login), limiter))
	rt.authenticated("POST /api/v1/auth/refresh", h.refresh)
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
	if blocked, wait := h.emails.blocked(req.Email); blocked {
		w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
		writeError(w, r, errTooManyAttempts)
		return
	}
	u, err := h.users.Authenticate(r.Context(), req.Email, req.Password)
	if errors.Is(err, user.ErrInvalidCredentials) {
		h.emails.failed(req.Email)
	}
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.emails.succeeded(req.Email)
	h.writeToken(w, r, u, h.tokens.now())
}

// refresh swaps a valid token for a new one, so a signed-in user who keeps the
// app open is not signed out every API_JWT_TTL. It reads the account again: a
// deactivated or deleted user is refused, and role changes take effect. The
// new token keeps the original sign-in time; once that is API_SESSION_MAX_AGE
// old the refresh is refused and the user signs in again.
func (h *authHandler) refresh(w http.ResponseWriter, r *http.Request) {
	raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		writeError(w, r, errUnauthenticated)
		return
	}
	claims, err := h.tokens.parse(strings.TrimSpace(raw))
	if err != nil {
		writeError(w, r, errUnauthenticated)
		return
	}
	signedIn := claims.signedInAt()
	if signedIn.IsZero() || h.tokens.now().Sub(signedIn) > h.tokens.sessionMax {
		writeError(w, r, errUnauthenticated)
		return
	}
	id, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	u, err := h.users.Get(r.Context(), id)
	if errors.Is(err, user.ErrNotFound) || (err == nil && !u.IsActive) {
		writeError(w, r, errUnauthenticated)
		return
	}
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.writeToken(w, r, u, signedIn)
}

// writeToken issues u a token for the sign-in at signedIn and writes it.
func (h *authHandler) writeToken(w http.ResponseWriter, r *http.Request, u user.User, signedIn time.Time) {
	token, exp, err := h.tokens.issueFor(u, signedIn)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, loginResponse{
		AccessToken: token,
		TokenType:   "Bearer",
		ExpiresIn:   int64(exp.Sub(h.tokens.now()).Seconds()),
		ExpiresAt:   exp.UTC(),
		User:        u,
	})
}
