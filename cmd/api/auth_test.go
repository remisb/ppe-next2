package main

import (
	"context"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/user"
)

const testSecret = "test-secret-test-secret-test-secret-0123"

func testTokens(now time.Time) *tokens {
	return &tokens{secret: []byte(testSecret), issuer: "ppe-next2", ttl: 15 * time.Minute, leeway: 30 * time.Second, now: func() time.Time { return now }}
}

func signClaims(t *testing.T, method jwt.SigningMethod, key any, c accessClaims) string {
	t.Helper()
	s, err := jwt.NewWithClaims(method, c).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestTokenRoundTrip(t *testing.T) {
	now := time.Now()
	tok := testTokens(now)
	u := user.User{ID: uuid.New(), Roles: []string{user.RoleManager, user.RoleEmployee}}
	raw, exp, err := tok.issue(u)
	if err != nil {
		t.Fatal(err)
	}
	if !exp.Equal(now.Add(15 * time.Minute)) {
		t.Errorf("exp = %v", exp)
	}
	c, err := tok.verify(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	if c.Subject != u.ID.String() || len(c.Roles) != 2 {
		t.Errorf("claims = %+v", c)
	}
}

func TestTokenRejections(t *testing.T) {
	now := time.Now()
	tok := testTokens(now)
	valid := func() accessClaims {
		return accessClaims{
			Roles: []string{"admin"},
			RegisteredClaims: jwt.RegisteredClaims{
				Subject:   uuid.NewString(),
				Issuer:    "ppe-next2",
				ExpiresAt: jwt.NewNumericDate(now.Add(time.Minute)),
			},
		}
	}
	tests := []struct {
		name string
		raw  func() string
	}{
		{"garbage", func() string { return "not.a.jwt" }},
		{"wrong secret", func() string {
			return signClaims(t, jwt.SigningMethodHS256, []byte("another-secret-another-secret-0000"), valid())
		}},
		{"alg none", func() string {
			return signClaims(t, jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, valid())
		}},
		{"HS512", func() string { return signClaims(t, jwt.SigningMethodHS512, []byte(testSecret), valid()) }},
		{"expired", func() string {
			c := valid()
			c.ExpiresAt = jwt.NewNumericDate(now.Add(-time.Minute))
			return signClaims(t, jwt.SigningMethodHS256, []byte(testSecret), c)
		}},
		{"no exp", func() string {
			c := valid()
			c.ExpiresAt = nil
			return signClaims(t, jwt.SigningMethodHS256, []byte(testSecret), c)
		}},
		{"wrong issuer", func() string {
			c := valid()
			c.Issuer = "someone-else"
			return signClaims(t, jwt.SigningMethodHS256, []byte(testSecret), c)
		}},
		{"subject not uuid", func() string {
			c := valid()
			c.Subject = "admin"
			return signClaims(t, jwt.SigningMethodHS256, []byte(testSecret), c)
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := tok.verify(context.Background(), tt.raw()); err != errInvalidToken {
				t.Fatalf("err = %v, want errInvalidToken", err)
			}
		})
	}
}

func TestTokenDropsUnknownRoles(t *testing.T) {
	now := time.Now()
	tok := testTokens(now)
	raw := signClaims(t, jwt.SigningMethodHS256, []byte(testSecret), accessClaims{
		Roles: []string{"ADMIN", "superuser"},
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: uuid.NewString(), Issuer: "ppe-next2", ExpiresAt: jwt.NewNumericDate(now.Add(time.Minute)),
		},
	})
	c, err := tok.verify(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Roles) != 1 || c.Roles[0] != user.RoleAdmin {
		t.Errorf("roles = %v, want [admin]", c.Roles)
	}
}
