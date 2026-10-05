package main

import (
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/remisb/ppe-next2/internal/domain/session"
)

// The refresh cookie: HttpOnly so no script, ours or injected, can read it;
// SameSite=Strict so no other site's page sends it; scoped to the auth routes
// so no other request carries it. Secure whenever the app is served over
// https (API_PUBLIC_BASE_URL); a plain-http development address leaves it off
// so every browser keeps the cookie on localhost.
const (
	refreshCookie = "ppe_refresh"
	refreshPath   = "/api/v1/auth"
)

// errCrossOrigin refuses a cookie route called from another site's page (403).
var errCrossOrigin = errors.New("cross-origin request refused")

type cookiePolicy struct {
	secure bool
	// origins are the app's own origins, as browsers send them in Origin.
	origins []string
}

func newCookiePolicy(cfg config) cookiePolicy {
	p := cookiePolicy{secure: strings.HasPrefix(cfg.PublicBaseURL, "https://")}
	if u, err := url.Parse(cfg.PublicBaseURL); err == nil {
		p.origins = append(p.origins, u.Scheme+"://"+u.Host)
	}
	p.origins = append(p.origins, cfg.AllowedOrigins...)
	return p
}

// set writes token as the refresh cookie for s. With Keep me signed in it
// lasts until the session's absolute limit (the server ends it sooner when
// idle); without, it is a browser-session cookie.
func (p cookiePolicy) set(w http.ResponseWriter, token string, s session.Session, now time.Time) {
	c := &http.Cookie{
		Name: refreshCookie, Value: token, Path: refreshPath,
		HttpOnly: true, Secure: p.secure, SameSite: http.SameSiteStrictMode,
	}
	if s.KeepSignedIn {
		c.Expires = s.ExpiresAt
		c.MaxAge = max(1, int(s.ExpiresAt.Sub(now).Seconds()))
	}
	http.SetCookie(w, c)
}

func (p cookiePolicy) clear(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: refreshCookie, Value: "", Path: refreshPath, MaxAge: -1,
		HttpOnly: true, Secure: p.secure, SameSite: http.SameSiteStrictMode,
	})
}

// sameOrigin checks a cookie route's Origin header, which browsers send with
// every POST: it must be the app's own (API_PUBLIC_BASE_URL or
// API_ALLOWED_ORIGINS) or the host the request was sent to (the Vite proxy on
// another port). SameSite=Strict already keeps the cookie off other sites'
// requests; this also stops another site signing a browser in to an account
// of its choosing. A request without Origin comes from no browser page, which
// has no cookie to misuse.
func (p cookiePolicy) sameOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" || slices.Contains(p.origins, o) {
		return true
	}
	u, err := url.Parse(o)
	return err == nil && u.Host != "" && u.Host == r.Host
}
