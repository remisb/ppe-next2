package main

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/role"
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
	u := user.User{ID: uuid.New(), RoleIDs: []uuid.UUID{role.ManagerID, role.EmployeeID}}
	sid := uuid.New()
	granted := role.BuiltinPermissions([]string{role.KeyManager, role.KeyEmployee})
	raw, exp, err := tok.issue(u, granted, sid, now.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	claims, err := tok.parse(raw)
	if err != nil || claims.sessionID() != sid || !claims.signedInAt().Equal(now.Add(-time.Hour).Truncate(time.Second)) {
		t.Errorf("sid %v, auth_time %v, %v", claims.sessionID(), claims.signedInAt(), err)
	}
	if !exp.Equal(now.Add(15 * time.Minute)) {
		t.Errorf("exp = %v", exp)
	}
	c, err := tok.verify(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	want := role.Strings(granted)
	if c.Subject != u.ID.String() || !slices.Equal(c.Roles, want) {
		t.Errorf("claims = %+v, want permissions %v", c, want)
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

func TestTokenDropsUnknownPermissions(t *testing.T) {
	now := time.Now()
	tok := testTokens(now)
	raw := signClaims(t, jwt.SigningMethodHS256, []byte(testSecret), accessClaims{
		Perms: []string{"orders.delete", "everything", "USERS.READ"},
		Roles: []string{"admin"},
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: uuid.NewString(), Issuer: "ppe-next2", ExpiresAt: jwt.NewNumericDate(now.Add(time.Minute)),
		},
	})
	c, err := tok.verify(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(c.Roles, []string{"orders.delete"}) {
		t.Errorf("permissions = %v, want [orders.delete]: unknown keys dropped, roles ignored when perms is present", c.Roles)
	}
}

// A token issued before permissions existed carries only roles; until it
// expires it grants its roles' built-in permissions.
func TestTokenWithoutPermissionsUsesRoles(t *testing.T) {
	now := time.Now()
	tok := testTokens(now)
	raw := signClaims(t, jwt.SigningMethodHS256, []byte(testSecret), accessClaims{
		Roles: []string{"MANAGER", "superuser"},
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: uuid.NewString(), Issuer: "ppe-next2", ExpiresAt: jwt.NewNumericDate(now.Add(time.Minute)),
		},
	})
	c, err := tok.verify(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	if want := role.Strings(role.BuiltinPermissions([]string{role.KeyManager})); !slices.Equal(c.Roles, want) {
		t.Errorf("permissions = %v, want %v", c.Roles, want)
	}
}
