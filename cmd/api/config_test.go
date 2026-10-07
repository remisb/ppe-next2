package main

import (
	"strings"
	"testing"
	"time"
)

func TestConfigValidate(t *testing.T) {
	ok := config{
		DBDSN: "postgres://x", DBMaxConns: 1, JWTSecret: strings.Repeat("s", 32), JWTTTL: 15 * time.Minute, SessionMaxAge: 12 * time.Hour,
		SessionKeepMaxAge: 30 * 24 * time.Hour, SessionKeepIdle: 14 * 24 * time.Hour, RecentSignIn: 12 * time.Hour,
		LoginRateLimit: 5, LoginRateInterval: time.Minute, LoginEmailFailures: 10, LoginEmailInterval: 15 * time.Minute,
		AuthEventsRetention: 180 * 24 * time.Hour, AuditRetention: 3653 * 24 * time.Hour, RequestTimeout: time.Second, OrgTimezone: "Europe/Vilnius",
		PublicBaseURL: "http://localhost:5180", ConfirmTTL: time.Hour,
	}
	if err := ok.validate(); err != nil {
		t.Fatalf("valid config: %v", err)
	}
	for name, mutate := range map[string]func(*config){
		"no dsn":                       func(c *config) { c.DBDSN = "" },
		"short secret":                 func(c *config) { c.JWTSecret = "short" },
		"ttl too long":                 func(c *config) { c.JWTTTL = 48 * time.Hour },
		"session shorter than a token": func(c *config) { c.SessionMaxAge = 5 * time.Minute },
		"session too long":             func(c *config) { c.SessionMaxAge = 31 * 24 * time.Hour },
		"kept shorter than not":        func(c *config) { c.SessionKeepMaxAge = 6 * time.Hour },
		"kept too long":                func(c *config) { c.SessionKeepMaxAge = 91 * 24 * time.Hour },
		"idle longer than kept":        func(c *config) { c.SessionKeepIdle = 31 * 24 * time.Hour },
		"idle shorter than a token":    func(c *config) { c.SessionKeepIdle = time.Minute },
		"recent sign-in too short":     func(c *config) { c.RecentSignIn = time.Minute },
		"no rate":                      func(c *config) { c.LoginRateLimit = 0 },
		"no email limit":               func(c *config) { c.LoginEmailFailures = 0 },
		"email interval too long":      func(c *config) { c.LoginEmailInterval = 25 * time.Hour },
		"auth events kept too short":   func(c *config) { c.AuthEventsRetention = 7 * 24 * time.Hour },
		"auth events kept too long":    func(c *config) { c.AuthEventsRetention = 4 * 365 * 24 * time.Hour },
		"metrics on the API's address": func(c *config) { c.Addr, c.MetricsAddr = ":8090", ":8090" },
		"audit kept under a year":      func(c *config) { c.AuditRetention = 300 * 24 * time.Hour },
		"bad timezone":                 func(c *config) { c.OrgTimezone = "Mars/Olympus" },
		"relative url":                 func(c *config) { c.PublicBaseURL = "/confirm" },
		"tsa not a url":                func(c *config) { c.AuditTSAURL = "timestamp.digicert.com" },
		"zero ttl":                     func(c *config) { c.ConfirmTTL = 0 },
	} {
		c := ok
		mutate(&c)
		if c.validate() == nil {
			t.Errorf("%s: expected error", name)
		}
	}
	seed := config{DBDSN: "postgres://x", DBMaxConns: 1, SeedAdmin: true}
	if seed.validate() == nil {
		t.Error("seed without email/password should fail")
	}
	seed.SeedUserEmail, seed.SeedUserPassword = "a@example.com", "password123"
	if err := seed.validate(); err != nil {
		t.Errorf("seed mode needs no JWT secret: %v", err)
	}
	demo := config{DBDSN: "postgres://x", DBMaxConns: 1, SeedDemo: true}
	if demo.validate() == nil {
		t.Error("seed-demo without API_SEED_USER_EMAIL should fail")
	}
	demo.SeedUserEmail = "a@example.com"
	if err := demo.validate(); err != nil {
		t.Errorf("seed-demo needs no JWT secret or password: %v", err)
	}
	verify := config{DBDSN: "postgres://x", DBMaxConns: 1, VerifyAudit: true}
	if err := verify.validate(); err != nil {
		t.Errorf("-verify-audit needs only the database: %v", err)
	}
	if err := (config{DBDSN: "postgres://x", DBMaxConns: 1, Upkeep: true}).validate(); err != nil {
		t.Errorf("-upkeep needs only the database: %v", err)
	}
	if (config{DBMaxConns: 1, VerifyAudit: true}).validate() == nil {
		t.Error("-verify-audit without API_DB_DSN should fail")
	}
	// The container healthcheck runs with the API's environment, but needs none of it.
	if err := (config{Healthcheck: true}).validate(); err != nil {
		t.Errorf("-healthcheck needs no database or secret: %v", err)
	}
	if c, err := loadConfig([]string{"-healthcheck", "-addr", ":9000"}); err != nil || !c.Healthcheck || c.Addr != ":9000" {
		t.Errorf("-healthcheck flag = %+v, %v", c.Healthcheck, err)
	}
}

// TestLoadConfigDefaults loads the real defaults, so a setting added to the
// struct but not read in loadConfig fails here rather than at startup.
func TestLoadConfigDefaults(t *testing.T) {
	for _, k := range []string{"API_PUBLIC_BASE_URL", "API_CONFIRM_TTL", "API_ORG_TIMEZONE", "API_JWT_TTL", "API_SESSION_MAX_AGE", "API_SESSION_KEEP_MAX_AGE", "API_SESSION_KEEP_IDLE", "API_RECENT_SIGN_IN", "API_TRUSTED_PROXIES", "API_LOGIN_EMAIL_FAILURES", "API_LOGIN_EMAIL_INTERVAL", "API_AUTH_EVENTS_RETENTION", "API_METRICS_ADDR", "API_AUDIT_RETENTION"} {
		t.Setenv(k, "")
	}
	t.Setenv("API_DB_DSN", "postgres://x")
	t.Setenv("API_JWT_SECRET", strings.Repeat("s", 32))
	c, err := loadConfig(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := c.validate(); err != nil {
		t.Fatalf("defaults do not validate: %v", err)
	}
	if c.PublicBaseURL != "http://localhost:5180" || c.ConfirmTTL != 7*24*time.Hour || c.OrgTimezone != "Europe/Vilnius" ||
		c.JWTTTL != 15*time.Minute || c.SessionMaxAge != 12*time.Hour || c.LoginEmailFailures != 10 || c.LoginEmailInterval != 15*time.Minute ||
		c.SessionKeepMaxAge != 30*24*time.Hour || c.SessionKeepIdle != 14*24*time.Hour || c.RecentSignIn != 12*time.Hour ||
		c.AuthEventsRetention != 180*24*time.Hour || c.MetricsAddr != "" || c.AuditRetention != 3653*24*time.Hour || c.AuditTSAURL != "" {
		t.Errorf("defaults = %+v", c)
	}
	if len(c.TrustedProxies) != 0 {
		t.Errorf("trusted proxies default = %v, want none", c.TrustedProxies)
	}
	t.Setenv("API_TRUSTED_PROXIES", "127.0.0.1, ::1")
	if c, err = loadConfig(nil); err != nil || len(c.TrustedProxies) != 2 {
		t.Errorf("trusted proxies = %v, %v", c.TrustedProxies, err)
	}
	t.Setenv("API_TRUSTED_PROXIES", "caddy")
	if _, err = loadConfig(nil); err == nil {
		t.Error("a host name in API_TRUSTED_PROXIES should fail")
	}
	t.Setenv("API_TRUSTED_PROXIES", "")
	t.Setenv("API_PUBLIC_BASE_URL", "https://work.example.com/")
	t.Setenv("API_ORG_TIMEZONE", "Europe/Riga")
	c, _ = loadConfig(nil)
	if c.PublicBaseURL != "https://work.example.com" || c.OrgTimezone != "Europe/Riga" {
		t.Errorf("overrides = %q %q", c.PublicBaseURL, c.OrgTimezone)
	}
}
