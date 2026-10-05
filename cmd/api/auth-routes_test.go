package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/session"
	"github.com/remisb/ppe-next2/internal/domain/user"
)

// browserRequest is a request as the web app sends it: an Origin, the
// refresh cookie for the auth routes, a Bearer token for the rest.
type browserRequest struct {
	token, cookie, origin string
	body                  any
}

func (a *testAPI) send(t *testing.T, method, path string, br browserRequest) *httptest.ResponseRecorder {
	t.Helper()
	var r io.Reader
	if br.body != nil {
		b, _ := json.Marshal(br.body)
		r = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, r)
	if br.token != "" {
		req.Header.Set("Authorization", "Bearer "+br.token)
	}
	if br.cookie != "" {
		req.AddCookie(&http.Cookie{Name: refreshCookie, Value: br.cookie})
	}
	if br.origin != "" {
		req.Header.Set("Origin", br.origin)
	}
	rec := httptest.NewRecorder()
	a.handler.ServeHTTP(rec, req)
	return rec
}

const appOrigin = "https://work.example.com"

// refreshCookieOf is the refresh cookie a response sets, or nil.
func refreshCookieOf(rec *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == refreshCookie {
			return c
		}
	}
	return nil
}

type tokenJSON struct {
	AccessToken string    `json:"access_token"`
	User        user.User `json:"user"`
}

// login signs email in and returns the access token's claims and the cookie.
func (a *testAPI) login(t *testing.T, email, password string, keep bool) (accessClaims, string, *http.Cookie) {
	t.Helper()
	rec := a.send(t, "POST", "/api/v1/auth/login", browserRequest{origin: appOrigin, body: map[string]any{"email": email, "password": password, "keep_signed_in": keep}})
	if rec.Code != http.StatusOK {
		t.Fatalf("login = %d %s", rec.Code, rec.Body)
	}
	tok := decode[tokenJSON](t, rec.Body.Bytes()).AccessToken
	claims, err := a.tokens.parse(tok)
	if err != nil {
		t.Fatal(err)
	}
	return claims, tok, refreshCookieOf(rec)
}

// Sign-in sets the refresh cookie: HttpOnly, Secure over https, SameSite=Strict,
// on the auth routes only; with Keep me signed in it lasts 30 days, without
// it ends with the browser. The access token names its session.
func TestSignInSetsRefreshCookie(t *testing.T) {
	api := newTestAPI(t)
	claims, _, c := api.login(t, "admin@example.com", "password123", true)
	if c == nil || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteStrictMode || c.Path != "/api/v1/auth" {
		t.Fatalf("cookie = %+v", c)
	}
	if month := int((30 * 24 * time.Hour).Seconds()); c.MaxAge < month-60 || c.MaxAge > month {
		t.Errorf("kept cookie Max-Age = %d, want 30 days", c.MaxAge)
	}
	if claims.sessionID().String() != strings.Split(c.Value, ".")[0] {
		t.Errorf("token sid %v, cookie %q", claims.sessionID(), c.Value)
	}

	_, _, c = api.login(t, "admin@example.com", "password123", false)
	if c == nil || c.MaxAge != 0 || !c.Expires.IsZero() {
		t.Errorf("browser-session cookie = %+v, want no Max-Age or Expires", c)
	}

	// Over plain http (a development address) the cookie is not Secure, so every browser keeps it.
	cfg := testConfig()
	cfg.PublicBaseURL = "http://localhost:5180"
	api.handler = routes(cfg, api.svc, api.tokens, testLogger)
	rec := api.send(t, "POST", "/api/v1/auth/login", browserRequest{body: map[string]any{"email": "admin@example.com", "password": "password123"}})
	if c := refreshCookieOf(rec); c == nil || c.Secure {
		t.Errorf("development cookie = %+v, want not Secure", c)
	}
}

// Refresh swaps the cookie for the next one and returns a token for the same
// sign-in, reading the account again; the cookie it replaced, used again at
// once (a second tab), gets the current one. No cookie, a garbage one, or a
// deactivated account is a 401 that clears the cookie.
func TestRefreshWithCookie(t *testing.T) {
	api := newTestAPI(t)
	ctx := context.Background()
	u, _ := api.userWith(t, user.RoleEmployee)
	first, _, c1 := api.login(t, u.Email, "password123", true)

	if _, err := api.svc.users.Update(ctx, u.ID, user.UpdateParams{Email: u.Email, Name: u.Name, Roles: []string{user.RoleEmployee, user.RoleManager}, IsActive: true}, api.admin.ID); err != nil {
		t.Fatal(err)
	}
	rec := api.send(t, "POST", "/api/v1/auth/refresh", browserRequest{cookie: c1.Value, origin: appOrigin})
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("refresh = %d %s", rec.Code, rec.Body)
	}
	c2 := refreshCookieOf(rec)
	if c2 == nil || c2.Value == c1.Value || !c2.HttpOnly {
		t.Fatalf("refreshed cookie = %+v", c2)
	}
	after, err := api.tokens.parse(decode[tokenJSON](t, rec.Body.Bytes()).AccessToken)
	if err != nil {
		t.Fatal(err)
	}
	if after.sessionID() != first.sessionID() || !after.signedInAt().Equal(first.signedInAt()) || len(after.Roles) != 2 {
		t.Errorf("refreshed token: sid %v (was %v), auth_time %v (was %v), roles %v", after.sessionID(), first.sessionID(), after.signedInAt(), first.signedInAt(), after.Roles)
	}

	rec = api.send(t, "POST", "/api/v1/auth/refresh", browserRequest{cookie: c1.Value})
	if c := refreshCookieOf(rec); rec.Code != http.StatusOK || c == nil || c.Value != c2.Value {
		t.Errorf("the replaced cookie at once = %d, cookie %+v; want the current one", rec.Code, c)
	}

	for name, cookie := range map[string]string{"no cookie": "", "garbage": "not-a-token"} {
		rec := api.send(t, "POST", "/api/v1/auth/refresh", browserRequest{cookie: cookie})
		if c := refreshCookieOf(rec); rec.Code != http.StatusUnauthorized || c == nil || c.MaxAge >= 0 {
			t.Errorf("%s = %d, cookie %+v; want 401 clearing it", name, rec.Code, c)
		}
	}

	if _, err := api.svc.users.Update(ctx, u.ID, user.UpdateParams{Email: u.Email, Name: u.Name, Roles: []string{user.RoleEmployee}, IsActive: false}, api.admin.ID); err != nil {
		t.Fatal(err)
	}
	if rec := api.send(t, "POST", "/api/v1/auth/refresh", browserRequest{cookie: c2.Value}); rec.Code != http.StatusUnauthorized {
		t.Errorf("deactivated = %d, want 401", rec.Code)
	}
}

// Login, refresh and logout act on the cookie, so another site's page may not
// call them: an Origin that is neither the app's nor the request's own host is
// a 403.
func TestCookieRoutesRefuseOtherSites(t *testing.T) {
	api := newTestAPI(t)
	_, _, c := api.login(t, "admin@example.com", "password123", true)
	login := map[string]any{"email": "admin@example.com", "password": "password123"}
	for _, path := range []string{"/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/logout"} {
		rec := api.send(t, "POST", path, browserRequest{cookie: c.Value, origin: "https://evil.example", body: login})
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s from another site = %d, want 403", path, rec.Code)
		}
	}
	// The request's own host (the Vite dev server on another port) is the app too.
	req := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(`{"email":"admin@example.com","password":"password123"}`))
	req.Host = "localhost:5182"
	req.Header.Set("Origin", "http://localhost:5182")
	rec := httptest.NewRecorder()
	api.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("login from the request's own host = %d, want 200", rec.Code)
	}
}

// Sign out ends the cookie's session and clears the cookie; the cookie no
// longer refreshes. Signing out again is harmless.
func TestLogout(t *testing.T) {
	api := newTestAPI(t)
	_, _, c := api.login(t, "admin@example.com", "password123", true)
	rec := api.send(t, "POST", "/api/v1/auth/logout", browserRequest{cookie: c.Value, origin: appOrigin})
	if cleared := refreshCookieOf(rec); rec.Code != http.StatusNoContent || cleared == nil || cleared.MaxAge >= 0 {
		t.Fatalf("logout = %d, cookie %+v", rec.Code, cleared)
	}
	if rec := api.send(t, "POST", "/api/v1/auth/refresh", browserRequest{cookie: c.Value}); rec.Code != http.StatusUnauthorized {
		t.Errorf("refresh after sign-out = %d, want 401", rec.Code)
	}
	for _, cookie := range []string{c.Value, ""} {
		if rec := api.send(t, "POST", "/api/v1/auth/logout", browserRequest{cookie: cookie}); rec.Code != http.StatusNoContent {
			t.Errorf("logout again = %d, want 204", rec.Code)
		}
	}
}

// Managing users needs the password entered within API_RECENT_SIGN_IN: an
// older sign-in gets a 403 until the password is confirmed (reauth), which a
// wrong password does not do and does not sign out (400, not 401).
func TestRecentSignIn(t *testing.T) {
	api := newTestAPI(t)
	_, fresh, _ := api.login(t, "admin@example.com", "password123", true)
	claims, err := api.tokens.parse(fresh)
	if err != nil {
		t.Fatal(err)
	}
	newUser := map[string]any{"email": "new@example.com", "name": "New", "password": "password123", "roles": []string{"employee"}}

	// The same sign-in, its password entered 13 hours ago.
	claims.AuthTime = jwt.NewNumericDate(time.Now().Add(-13 * time.Hour))
	stale := signClaims(t, jwt.SigningMethodHS256, []byte(testSecret), claims)
	rec := api.send(t, "POST", "/api/v1/users", browserRequest{token: stale, body: newUser})
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "recent sign-in required") {
		t.Fatalf("stale sign-in = %d %s, want 403 recent sign-in required", rec.Code, rec.Body)
	}
	// Everything else still works.
	if rec := api.send(t, "GET", "/api/v1/users", browserRequest{token: stale}); rec.Code != http.StatusOK {
		t.Errorf("list users with a stale sign-in = %d", rec.Code)
	}

	if rec := api.send(t, "POST", "/api/v1/auth/reauth", browserRequest{token: stale, body: map[string]string{"password": "wrong-password"}}); rec.Code != http.StatusBadRequest {
		t.Fatalf("wrong password = %d %s, want 400", rec.Code, rec.Body)
	}
	rec = api.send(t, "POST", "/api/v1/auth/reauth", browserRequest{token: stale, body: map[string]string{"password": "password123"}})
	if rec.Code != http.StatusOK {
		t.Fatalf("reauth = %d %s", rec.Code, rec.Body)
	}
	confirmed := decode[tokenJSON](t, rec.Body.Bytes()).AccessToken
	if got, _ := api.tokens.parse(confirmed); got.sessionID() != claims.sessionID() || time.Since(got.signedInAt()) > time.Minute {
		t.Errorf("confirmed token: sid %v, auth_time %v", got.sessionID(), got.signedInAt())
	}
	if rec := api.send(t, "POST", "/api/v1/users", browserRequest{token: confirmed, body: newUser}); rec.Code != http.StatusCreated {
		t.Errorf("create after reauth = %d %s", rec.Code, rec.Body)
	}

	// Once the sign-in has ended, confirming the password does not bring it back.
	if err := api.svc.sessions.EndAll(context.Background(), api.admin.ID, uuid.Nil, session.ReasonSignedOut); err != nil {
		t.Fatal(err)
	}
	if rec := api.send(t, "POST", "/api/v1/auth/reauth", browserRequest{token: confirmed, body: map[string]string{"password": "password123"}}); rec.Code != http.StatusUnauthorized {
		t.Errorf("reauth in an ended sign-in = %d, want 401", rec.Code)
	}
}

// Account lists the user's signed-in devices, this one marked, and signs the
// others out, one or all; another user's device is a 404.
func TestSignedInDevices(t *testing.T) {
	api := newTestAPI(t)
	u, _ := api.userWith(t, user.RoleEmployee)
	here, tok, hereCookie := api.login(t, u.Email, "password123", true)
	_, _, phone := api.login(t, u.Email, "password123", false)
	_, _, laptop := api.login(t, u.Email, "password123", true)
	_, adminTok, _ := api.login(t, "admin@example.com", "password123", true)

	type device struct {
		ID      string `json:"id"`
		Current bool   `json:"current"`
	}
	list := func() []device {
		rec := api.send(t, "GET", "/api/v1/auth/sessions", browserRequest{token: tok})
		if rec.Code != http.StatusOK {
			t.Fatalf("list = %d %s", rec.Code, rec.Body)
		}
		return decode[[]device](t, rec.Body.Bytes())
	}
	// userWith's own sign-in, and the three logins.
	got := list()
	current := 0
	for _, d := range got {
		if d.Current {
			current++
			if d.ID != here.sessionID().String() {
				t.Errorf("current = %s, want %s", d.ID, here.sessionID())
			}
		}
	}
	if len(got) != 4 || current != 1 {
		t.Fatalf("devices = %+v", got)
	}

	phoneID := strings.Split(phone.Value, ".")[0]
	if rec := api.send(t, "DELETE", "/api/v1/auth/sessions/"+phoneID, browserRequest{token: adminTok}); rec.Code != http.StatusNotFound {
		t.Errorf("another user's device = %d, want 404", rec.Code)
	}
	if rec := api.send(t, "DELETE", "/api/v1/auth/sessions/"+phoneID, browserRequest{token: tok}); rec.Code != http.StatusNoContent {
		t.Fatalf("sign out the phone = %d %s", rec.Code, rec.Body)
	}
	if rec := api.send(t, "POST", "/api/v1/auth/refresh", browserRequest{cookie: phone.Value}); rec.Code != http.StatusUnauthorized {
		t.Errorf("the phone's refresh = %d, want 401", rec.Code)
	}
	if rec := api.send(t, "DELETE", "/api/v1/auth/sessions", browserRequest{token: tok}); rec.Code != http.StatusNoContent {
		t.Fatalf("sign out the others = %d", rec.Code)
	}
	if got := list(); len(got) != 1 || !got[0].Current {
		t.Errorf("after signing out the others: %+v", got)
	}
	if rec := api.send(t, "POST", "/api/v1/auth/refresh", browserRequest{cookie: laptop.Value}); rec.Code != http.StatusUnauthorized {
		t.Errorf("the laptop's refresh = %d, want 401", rec.Code)
	}
	if rec := api.send(t, "POST", "/api/v1/auth/refresh", browserRequest{cookie: hereCookie.Value}); rec.Code != http.StatusOK {
		t.Errorf("this device's refresh = %d, want 200", rec.Code)
	}
}

// Changing one's password signs out the other devices and keeps this one; an
// administrator's reset, or deleting the account, signs out all of them.
func TestPasswordChangesEndSessions(t *testing.T) {
	api := newTestAPI(t)
	u, _ := api.userWith(t, user.RoleEmployee)
	_, tok, here := api.login(t, u.Email, "password123", true)
	_, _, elsewhere := api.login(t, u.Email, "password123", true)
	refreshes := func(c *http.Cookie) bool {
		rec := api.send(t, "POST", "/api/v1/auth/refresh", browserRequest{cookie: c.Value})
		if n := refreshCookieOf(rec); n != nil && rec.Code == http.StatusOK {
			*c = *n
		}
		return rec.Code == http.StatusOK
	}

	rec := api.send(t, "PUT", "/api/v1/users/me/password", browserRequest{token: tok, body: map[string]string{"current_password": "password123", "new_password": "password456"}})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("change password = %d %s", rec.Code, rec.Body)
	}
	if refreshes(elsewhere) {
		t.Error("another device still signed in after a password change")
	}
	if !refreshes(here) {
		t.Fatal("this device was signed out by its own password change")
	}

	_, adminTok, _ := api.login(t, "admin@example.com", "password123", true)
	if rec := api.send(t, "PUT", "/api/v1/users/"+u.ID.String()+"/password", browserRequest{token: adminTok, body: map[string]string{"password": "password789"}}); rec.Code != http.StatusNoContent {
		t.Fatalf("reset = %d %s", rec.Code, rec.Body)
	}
	if refreshes(here) {
		t.Error("still signed in after an administrator's reset")
	}

	_, _, again := api.login(t, u.Email, "password789", true)
	if rec := api.send(t, "DELETE", "/api/v1/users/"+u.ID.String(), browserRequest{token: adminTok}); rec.Code != http.StatusNoContent {
		t.Fatalf("delete = %d", rec.Code)
	}
	if refreshes(again) {
		t.Error("still signed in after the account was deleted")
	}
}
