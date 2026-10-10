package main

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/user"
)

// errInvalidToken is the only error the verifier returns. muxstack echoes it in
// the 401 body, so it must not say why a token was rejected.
var errInvalidToken = errors.New("invalid token")

// accessClaims is the JWT payload: sub is the user ID, perms the permissions
// the user's roles granted when the token was issued (a refresh reads them
// again, so a role change takes effect within minutes), sid the sign-in
// (session) it was issued for, and auth_time when the password was last
// entered in that sign-in, which managing users checks (requireRecentSignIn).
// roles is only read: tokens issued before permissions carried role names.
type accessClaims struct {
	Perms     []string         `json:"perms"`
	Roles     []string         `json:"roles,omitempty"`
	SessionID string           `json:"sid,omitempty"`
	AuthTime  *jwt.NumericDate `json:"auth_time,omitempty"`
	jwt.RegisteredClaims
}

// tokens issues and verifies HS256 access tokens.
type tokens struct {
	secret []byte
	issuer string
	ttl    time.Duration
	leeway time.Duration
	now    func() time.Time
}

func newTokens(cfg config) *tokens {
	return &tokens{
		secret: []byte(cfg.JWTSecret),
		issuer: cfg.JWTIssuer,
		ttl:    cfg.JWTTTL,
		leeway: 30 * time.Second,
		now:    time.Now,
	}
}

// issue signs a token granting perms to u in sign-in sid, whose password was
// entered at authTime.
func (t *tokens) issue(u user.User, perms []role.Permission, sid uuid.UUID, authTime time.Time) (string, time.Time, error) {
	now := t.now()
	exp := now.Add(t.ttl)
	claims := accessClaims{
		Perms:     role.Strings(perms),
		SessionID: sid.String(),
		AuthTime:  jwt.NewNumericDate(authTime),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   u.ID.String(),
			Issuer:    t.issuer,
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(t.secret)
	return signed, exp, err
}

// verify is the muxstack TokenVerifier. muxstack calls them roles, and its
// Authorizer admits a request holding any of the route's; here they are the
// token's permission keys, and every route names exactly one. Unknown keys
// are dropped.
func (t *tokens) verify(_ context.Context, raw string) (*middleware.Claims, error) {
	claims, err := t.parse(raw)
	if err != nil {
		return nil, err
	}
	return &middleware.Claims{Subject: claims.Subject, Roles: role.Strings(claims.permissions())}, nil
}

// permissions are the token's known permissions. A token issued before
// permissions existed has only role names; until it expires (API_JWT_TTL
// after the upgrade) it is granted the built-in roles' installed permissions.
func (c accessClaims) permissions() []role.Permission {
	if c.Perms == nil && c.Roles != nil {
		keys := make([]string, len(c.Roles))
		for i, r := range c.Roles {
			keys[i] = strings.ToLower(strings.TrimSpace(r))
		}
		return role.BuiltinPermissions(keys)
	}
	return role.Known(c.Perms)
}

// signedInAt is when the token's user last entered their password: auth_time,
// or for a token issued before auth_time existed, its issue time.
func (c accessClaims) signedInAt() time.Time {
	switch {
	case c.AuthTime != nil:
		return c.AuthTime.Time
	case c.IssuedAt != nil:
		return c.IssuedAt.Time
	}
	return time.Time{}
}

// parse checks raw and returns its claims. The algorithm is pinned to HS256 so
// a token cannot choose "none" or an asymmetric algorithm keyed by our secret.
func (t *tokens) parse(raw string) (accessClaims, error) {
	opts := []jwt.ParserOption{
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(t.leeway),
		jwt.WithTimeFunc(t.now),
	}
	if t.issuer != "" {
		opts = append(opts, jwt.WithIssuer(t.issuer))
	}
	var claims accessClaims
	if _, err := jwt.ParseWithClaims(raw, &claims, func(*jwt.Token) (any, error) {
		return t.secret, nil
	}, opts...); err != nil {
		return accessClaims{}, errInvalidToken
	}
	// A subject that is not a UUID cannot be an actor; reject it here as a 401
	// rather than letting a handler turn it into a 400.
	if _, err := uuid.Parse(claims.Subject); err != nil {
		return accessClaims{}, errInvalidToken
	}
	return claims, nil
}

// sessionID is the sign-in the token was issued for; uuid.Nil for a token
// issued before sign-ins were kept.
func (c accessClaims) sessionID() uuid.UUID {
	id, err := uuid.Parse(c.SessionID)
	if err != nil {
		return uuid.Nil
	}
	return id
}

// bearer parses the request's access token. Routes calling it sit behind
// middleware.Authenticator, which has already verified it; this reads the
// claims muxstack does not keep (sid, auth_time).
func (t *tokens) bearer(r *http.Request) (accessClaims, error) {
	raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return accessClaims{}, errUnauthenticated
	}
	claims, err := t.parse(strings.TrimSpace(raw))
	if err != nil {
		return accessClaims{}, errUnauthenticated
	}
	return claims, nil
}

// holds reports whether the request's token grants p. Routes need one
// permission each (router); this is for what a route shows depending on more.
func holds(r *http.Request, p role.Permission) bool {
	c, ok := middleware.ClaimsFromContext(r.Context())
	return ok && slices.Contains(c.Roles, string(p))
}

// actorID returns the authenticated user's ID. Routes calling it sit behind
// middleware.Authenticator, whose verifier has already checked the subject.
func actorID(r *http.Request) (uuid.UUID, error) {
	c, ok := middleware.ClaimsFromContext(r.Context())
	if !ok {
		return uuid.Nil, errUnauthenticated
	}
	id, err := uuid.Parse(c.Subject)
	if err != nil {
		return uuid.Nil, errUnauthenticated
	}
	return id, nil
}
