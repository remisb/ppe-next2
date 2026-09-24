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

	"github.com/remisb/ppe-next2/internal/domain/user"
)

// errInvalidToken is the only error the verifier returns. muxstack echoes it in
// the 401 body, so it must not say why a token was rejected.
var errInvalidToken = errors.New("invalid token")

// accessClaims is the JWT payload: sub is the user ID, roles the user's roles
// at the time of login. Role changes take effect when the token expires.
type accessClaims struct {
	Roles []string `json:"roles"`
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

func (t *tokens) issue(u user.User) (string, time.Time, error) {
	now := t.now()
	exp := now.Add(t.ttl)
	claims := accessClaims{
		Roles: slices.Clone(u.Roles),
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

// verify is the muxstack TokenVerifier. The algorithm is pinned to HS256 so a
// token cannot choose "none" or an asymmetric algorithm keyed by our secret.
func (t *tokens) verify(_ context.Context, raw string) (*middleware.Claims, error) {
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
		return nil, errInvalidToken
	}
	// A subject that is not a UUID cannot be an actor; reject it here as a 401
	// rather than letting a handler turn it into a 400.
	if _, err := uuid.Parse(claims.Subject); err != nil {
		return nil, errInvalidToken
	}
	roles := make([]string, 0, len(claims.Roles))
	for _, r := range claims.Roles {
		if r = strings.ToLower(strings.TrimSpace(r)); user.IsKnownRole(r) {
			roles = append(roles, r)
		}
	}
	return &middleware.Claims{Subject: claims.Subject, Roles: roles}, nil
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
