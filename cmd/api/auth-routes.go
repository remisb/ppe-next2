package main

import (
	"errors"
	"math"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/session"
	"github.com/remisb/ppe-next2/internal/domain/user"
	"github.com/remisb/ppe-next2/internal/monitor"
	"github.com/remisb/ppe-next2/internal/security"
)

// errRecentSignInRequired refuses managing users when the password was last
// entered longer than API_RECENT_SIGN_IN ago (403). The web app recognises the
// message, asks for the password (POST /api/v1/auth/reauth) and tries again.
var errRecentSignInRequired = errors.New("recent sign-in required")

// errTooManyAttempts refuses a sign-in for an account that has had too many
// failed ones recently (429).
var errTooManyAttempts = errors.New("too many failed sign-ins for this account; try again later")

type authHandler struct {
	users    *user.Service
	roles    *role.Service
	sessions *session.Service
	security *security.Service
	metrics  *monitor.Metrics
	tokens   *tokens
	cookies  cookiePolicy
}

// registerAuthRoutes mounts sign-in and the signed-in devices.
//
// A sign-in is a session (internal/domain/session) whose refresh token lives
// in an HttpOnly cookie scoped to /api/v1/auth (auth-cookie.go); the API's
// other routes take the short access token as a Bearer header. login, refresh
// and logout are public because the cookie, not a token, says who is asking.
//
// Two limits slow password guessing, at login and when the password is
// confirmed again (reauth). Every attempt counts against the client address
// (middleware.ClientAddr, resolved by the global ClientIP middleware), which
// stops one address spreading guesses across many accounts. Failed attempts
// also count against the email, in the security log (security.Service.Blocked),
// which stops many addresses guessing at one account, across restarts and
// instances. Every sign-in, failure and ended session is recorded there
// (docs/specs/security-service.md).
func registerAuthRoutes(rt *router, svc services, tokens *tokens, cfg config) {
	h := &authHandler{
		users: svc.users, roles: svc.roles, sessions: svc.sessions, security: svc.security, metrics: svc.metrics,
		tokens: tokens, cookies: newCookiePolicy(cfg),
	}
	limiter := middleware.RateLimiter(middleware.RateLimitConfig{
		RequestsPerInterval: cfg.LoginRateLimit,
		Interval:            cfg.LoginRateInterval,
		KeyFunc:             middleware.ClientAddr,
	})
	rt.public("POST /api/v1/auth/login", middleware.Chain(http.HandlerFunc(h.login), limiter))
	rt.public("POST /api/v1/auth/refresh", http.HandlerFunc(h.refresh))
	rt.public("POST /api/v1/auth/logout", http.HandlerFunc(h.logout))
	rt.authenticated("POST /api/v1/auth/reauth", limiter(http.HandlerFunc(h.reauth)).ServeHTTP)
	rt.authenticated("GET /api/v1/auth/sessions", h.listSessions)
	rt.authenticated("DELETE /api/v1/auth/sessions", h.endOtherSessions)
	rt.authenticated("DELETE /api/v1/auth/sessions/{id}", h.endSession)
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	// KeepSignedIn is "Keep me signed in": a cookie that outlives the browser
	// and the longer session limits.
	KeepSignedIn bool `json:"keep_signed_in"`
}

type loginResponse struct {
	AccessToken string    `json:"access_token"`
	TokenType   string    `json:"token_type"`
	ExpiresIn   int64     `json:"expires_in"`
	ExpiresAt   time.Time `json:"expires_at"`
	User        user.User `json:"user"`
}

// seen is the browser and client address a request comes from.
func seen(r *http.Request) session.Seen {
	return session.Seen{UserAgent: r.UserAgent(), IP: middleware.ClientAddr(r)}
}

func (h *authHandler) login(w http.ResponseWriter, r *http.Request) {
	if !h.cookies.sameOrigin(r) {
		writeError(w, r, errCrossOrigin)
		return
	}
	var req loginRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	email := h.security.EmailHash(req.Email)
	if h.limited(w, r, security.KindSignInFailed, email, uuid.Nil) {
		return
	}
	u, err := h.users.Authenticate(r.Context(), req.Email, req.Password)
	var refused *user.SignInRefused
	if errors.As(err, &refused) {
		h.metrics.SignInFailed(refused.Reason)
		if err := h.security.Refused(r.Context(), security.KindSignInFailed, email, refused.UserID, refused.Reason); err != nil {
			writeError(w, r, err)
			return
		}
	}
	if err != nil {
		writeError(w, r, err)
		return
	}
	by := seen(r)
	s, refresh, err := h.sessions.Start(r.Context(), session.StartParams{
		UserID: u.ID, KeepSignedIn: req.KeepSignedIn, UserAgent: by.UserAgent, IP: by.IP, EmailHash: email,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.cookies.set(w, refresh, s, h.tokens.now())
	h.writeToken(w, r, u, s)
}

// refresh swaps the refresh cookie for the next one and a new access token,
// so a signed-in browser stays signed in without the password: across closed
// tabs, reloads and a sleeping device, until the session's limits. It reads
// the account again: a deactivated or deleted user is refused, and role
// changes take effect. Any refusal clears the cookie and is a 401.
func (h *authHandler) refresh(w http.ResponseWriter, r *http.Request) {
	if !h.cookies.sameOrigin(r) {
		writeError(w, r, errCrossOrigin)
		return
	}
	c, err := r.Cookie(refreshCookie)
	if err != nil {
		h.refuse(w, r)
		return
	}
	s, token, err := h.sessions.Refresh(r.Context(), c.Value, seen(r))
	if errors.Is(err, session.ErrInvalidToken) {
		h.refuse(w, r)
		return
	}
	if err != nil {
		writeError(w, r, err)
		return
	}
	u, err := h.users.Get(r.Context(), s.UserID)
	if errors.Is(err, user.ErrNotFound) || (err == nil && !u.IsActive) {
		h.refuse(w, r)
		return
	}
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.cookies.set(w, token, s, h.tokens.now())
	h.writeToken(w, r, u, s)
}

// refuse clears the refresh cookie and answers 401.
func (h *authHandler) refuse(w http.ResponseWriter, r *http.Request) {
	h.cookies.clear(w)
	writeError(w, r, errUnauthenticated)
}

// logout ends the cookie's session and clears the cookie. It always succeeds:
// a missing, unknown or already ended session leaves nothing to end.
func (h *authHandler) logout(w http.ResponseWriter, r *http.Request) {
	if !h.cookies.sameOrigin(r) {
		writeError(w, r, errCrossOrigin)
		return
	}
	if c, err := r.Cookie(refreshCookie); err == nil {
		if err := h.sessions.SignOut(r.Context(), c.Value); err != nil && !errors.Is(err, session.ErrInvalidToken) {
			writeError(w, r, err)
			return
		}
	}
	h.cookies.clear(w)
	w.WriteHeader(http.StatusNoContent)
}

type reauthRequest struct {
	Password string `json:"password"`
}

// reauth confirms the signed-in user's password in this sign-in and returns a
// new access token whose auth_time is now, for actions that need a recent
// sign-in (requireRecentSignIn). A wrong password is a 400 naming the field,
// not a 401, which would sign the app out.
func (h *authHandler) reauth(w http.ResponseWriter, r *http.Request) {
	claims, err := h.tokens.bearer(r)
	if err != nil || claims.sessionID() == uuid.Nil {
		writeError(w, r, errUnauthenticated)
		return
	}
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req reauthRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	u, err := h.users.Get(r.Context(), actor)
	if errors.Is(err, user.ErrNotFound) {
		err = errUnauthenticated
	}
	if err != nil {
		writeError(w, r, err)
		return
	}
	email := h.security.EmailHash(u.Email)
	if h.limited(w, r, security.KindReauthFailed, email, u.ID) {
		return
	}
	if err := h.users.CheckPassword(r.Context(), actor, req.Password); err != nil {
		if errors.Is(err, user.ErrInvalid) {
			h.metrics.SignInFailed(security.ReasonBadPassword)
			if err := h.security.Refused(r.Context(), security.KindReauthFailed, email, u.ID, security.ReasonBadPassword); err != nil {
				writeError(w, r, err)
				return
			}
		}
		writeError(w, r, err)
		return
	}
	s, err := h.sessions.Reauthenticated(r.Context(), actor, claims.sessionID(), email)
	if errors.Is(err, session.ErrNotFound) {
		err = errUnauthenticated
	}
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.writeToken(w, r, u, s)
}

// limited refuses an attempt at email while the per-email limit holds it (429
// with Retry-After), recording the refusal as kind for userID (uuid.Nil when
// not known), and reports whether it did.
func (h *authHandler) limited(w http.ResponseWriter, r *http.Request, kind security.Kind, email []byte, userID uuid.UUID) bool {
	wait, err := h.security.Blocked(r.Context(), email)
	if err == nil && wait > 0 {
		h.metrics.SignInFailed(security.ReasonTooManyAttempts)
		err = h.security.Refused(r.Context(), kind, email, userID, security.ReasonTooManyAttempts)
		if err == nil {
			w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
			err = errTooManyAttempts
		}
	}
	if err != nil {
		writeError(w, r, err)
		return true
	}
	return false
}

// writeToken issues u an access token for session s, granting what u's roles
// allow now, and writes it.
func (h *authHandler) writeToken(w http.ResponseWriter, r *http.Request, u user.User, s session.Session) {
	perms, err := h.roles.Permissions(r.Context(), u.RoleIDs)
	if err != nil {
		writeError(w, r, err)
		return
	}
	token, exp, err := h.tokens.issue(u, perms, s.ID, s.AuthenticatedAt)
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

// signedInDevice is one of the user's sessions as Account lists it.
type signedInDevice struct {
	ID string `json:"id"`
	// Current is the session the request's token belongs to: this device.
	Current      bool      `json:"current"`
	KeepSignedIn bool      `json:"keep_signed_in"`
	CreatedAt    time.Time `json:"created_at"`
	LastUsedAt   time.Time `json:"last_used_at"`
	// ExpiresAt is when it ends if not used before: the earlier of its idle
	// and absolute limits.
	ExpiresAt time.Time `json:"expires_at"`
	UserAgent string    `json:"user_agent"`
	IP        string    `json:"ip"`
}

func (h *authHandler) listSessions(w http.ResponseWriter, r *http.Request) {
	actor, claims, ok := h.signedIn(w, r)
	if !ok {
		return
	}
	list, err := h.sessions.List(r.Context(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]signedInDevice, 0, len(list))
	for _, s := range list {
		ends := s.ExpiresAt
		if s.IdleExpiresAt.Before(ends) {
			ends = s.IdleExpiresAt
		}
		out = append(out, signedInDevice{
			ID: s.ID.String(), Current: s.ID == claims.sessionID(), KeepSignedIn: s.KeepSignedIn,
			CreatedAt: s.CreatedAt, LastUsedAt: s.LastUsedAt, ExpiresAt: ends, UserAgent: s.UserAgent, IP: s.IP,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// endOtherSessions signs the user out everywhere but this device.
func (h *authHandler) endOtherSessions(w http.ResponseWriter, r *http.Request) {
	actor, claims, ok := h.signedIn(w, r)
	if !ok {
		return
	}
	if err := h.sessions.EndAll(r.Context(), actor, claims.sessionID(), session.ReasonEndedElsewhere); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// endSession signs one of the user's devices out; another user's is a 404.
func (h *authHandler) endSession(w http.ResponseWriter, r *http.Request) {
	actor, _, ok := h.signedIn(w, r)
	if !ok {
		return
	}
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	if err := h.sessions.End(r.Context(), actor, id); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// signedIn reads the actor and the token's claims, writing the error if it fails.
func (h *authHandler) signedIn(w http.ResponseWriter, r *http.Request) (actor uuid.UUID, claims accessClaims, ok bool) {
	actor, err := actorID(r)
	if err == nil {
		claims, err = h.tokens.bearer(r)
	}
	if err != nil {
		writeError(w, r, err)
		return actor, claims, false
	}
	return actor, claims, true
}

// errPermissionWithdrawn: the token grants the route's permission, but the
// user's roles no longer do (changed since the token was issued).
var errPermissionWithdrawn = errors.New("forbidden: your roles no longer allow this")

// requireSensitive wraps the handlers of routes that manage users and roles:
// besides the permission in the token (the route's Authorizer), the password
// must have been entered recently (requireRecentSignIn), and the user's roles
// must still grant perm now, read from the database, so a demoted
// administrator is refused at once rather than at their next refresh.
func requireSensitive(tok *tokens, maxAge time.Duration, roles *role.Service) func(role.Permission, http.HandlerFunc) http.HandlerFunc {
	recent := requireRecentSignIn(tok, maxAge)
	return func(perm role.Permission, next http.HandlerFunc) http.HandlerFunc {
		return recent(func(w http.ResponseWriter, r *http.Request) {
			actor, err := actorID(r)
			if err != nil {
				writeError(w, r, err)
				return
			}
			perms, err := roles.PermissionsOf(r.Context(), actor)
			if err != nil {
				writeError(w, r, err)
				return
			}
			if !slices.Contains(perms, perm) {
				writeError(w, r, errPermissionWithdrawn)
				return
			}
			next(w, r)
		})
	}
}

// requireRecentSignIn wraps a handler that needs the password to have been
// entered within maxAge: at sign-in or confirmed since (reauth). Older, it is
// a 403 errRecentSignInRequired.
func requireRecentSignIn(tok *tokens, maxAge time.Duration) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			claims, err := tok.bearer(r)
			if err != nil {
				writeError(w, r, err)
				return
			}
			if at := claims.signedInAt(); at.IsZero() || tok.now().Sub(at) > maxAge {
				writeError(w, r, errRecentSignInRequired)
				return
			}
			next(w, r)
		}
	}
}
