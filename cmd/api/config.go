package main

import (
	"errors"
	"flag"
	"fmt"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/remisb/muxstack/middleware"
)

type config struct {
	Addr            string
	DBDSN           string
	DBMaxConns      int
	RequestTimeout  time.Duration
	ShutdownTimeout time.Duration

	JWTSecret string
	JWTIssuer string
	JWTTTL    time.Duration
	// SessionMaxAge ends a sign-in without "Keep me signed in" this long after
	// it began; its cookie also ends with the browser.
	SessionMaxAge time.Duration
	// SessionKeepMaxAge ends one with it this long after it began, and
	// SessionKeepIdle once it has gone unused this long.
	SessionKeepMaxAge time.Duration
	SessionKeepIdle   time.Duration
	// RecentSignIn is how recently the password must have been entered to
	// manage users; older, the app asks for it again (POST /api/v1/auth/reauth).
	RecentSignIn time.Duration

	LoginRateLimit    int
	LoginRateInterval time.Duration
	// LoginEmailFailures failed sign-ins for one email within
	// LoginEmailInterval refuse that email until the interval ends, whatever
	// address the attempts come from (emailLimiter).
	LoginEmailFailures int
	LoginEmailInterval time.Duration
	// AuthEventsRetention is how long security events (sign-ins, failed
	// attempts, ended sessions) are kept; older ones are purged hourly.
	AuthEventsRetention time.Duration
	// AuditRetention is how long audit events are kept; older ones are
	// purged, whole sealed days at a time (ADR 0003: 10 years, pending the
	// accountant's word).
	AuditRetention time.Duration
	AllowedOrigins []string
	// TrustedProxies are the reverse proxies (e.g. Caddy) whose
	// X-Forwarded-For is believed when finding the client for rate limits.
	TrustedProxies []netip.Prefix

	// OrgTimezone is the organisation's IANA zone: History date filters and
	// usage time count calendar days there. Timestamps are stored in UTC.
	OrgTimezone string

	// PublicBaseURL is where the web app is served; confirmation links are
	// PublicBaseURL + "/confirm/" + token.
	PublicBaseURL string
	ConfirmTTL    time.Duration

	// SeedAdmin runs Bootstrap with the API_SEED_USER_* values and exits.
	SeedAdmin bool
	// SeedDemo fills an empty database with demo data as that admin and exits.
	SeedDemo         bool
	SeedUserEmail    string
	SeedUserPassword string
	SeedUserName     string

	// MetricsAddr is the internal listener for Prometheus's /metrics; empty
	// serves none. Never published by Caddy.
	MetricsAddr string

	// Healthcheck asks the API at Addr whether it is ready (GET /ready) and
	// exits: the container healthcheck, as the image has no curl.
	Healthcheck bool
}

// loadConfig reads env vars, then lets flags override the non-secret ones.
// Secrets (JWT secret, seed password) have no flag so they never appear in ps.
func loadConfig(args []string) (config, error) {
	c := config{
		Addr:             env("API_ADDR", ":8090"),
		DBDSN:            env("API_DB_DSN", ""),
		JWTSecret:        env("API_JWT_SECRET", ""),
		JWTIssuer:        env("API_JWT_ISSUER", "ppe-next2"),
		SeedUserEmail:    env("API_SEED_USER_EMAIL", ""),
		SeedUserPassword: env("API_SEED_USER_PASSWORD", ""),
		SeedUserName:     env("API_SEED_USER_NAME", "Administrator"),
		AllowedOrigins:   splitList(env("API_ALLOWED_ORIGINS", "")),
		OrgTimezone:      env("API_ORG_TIMEZONE", "Europe/Vilnius"),
		PublicBaseURL:    strings.TrimRight(env("API_PUBLIC_BASE_URL", "http://localhost:5180"), "/"),
		MetricsAddr:      env("API_METRICS_ADDR", ""),
	}
	var err error
	if c.TrustedProxies, err = middleware.ParseTrustedProxies(splitList(env("API_TRUSTED_PROXIES", ""))); err != nil {
		return c, fmt.Errorf("API_TRUSTED_PROXIES: %w", err)
	}
	if c.DBMaxConns, err = envInt("API_DB_MAX_CONNS", 10); err != nil {
		return c, err
	}
	if c.LoginRateLimit, err = envInt("API_LOGIN_RATE_LIMIT", 5); err != nil {
		return c, err
	}
	if c.LoginEmailFailures, err = envInt("API_LOGIN_EMAIL_FAILURES", 10); err != nil {
		return c, err
	}
	for _, d := range []struct {
		dst *time.Duration
		key string
		def time.Duration
	}{
		{&c.RequestTimeout, "API_REQUEST_TIMEOUT", 10 * time.Second},
		{&c.ShutdownTimeout, "API_SHUTDOWN_TIMEOUT", 10 * time.Second},
		{&c.JWTTTL, "API_JWT_TTL", 15 * time.Minute},
		{&c.SessionMaxAge, "API_SESSION_MAX_AGE", 12 * time.Hour},
		{&c.SessionKeepMaxAge, "API_SESSION_KEEP_MAX_AGE", 30 * 24 * time.Hour},
		{&c.SessionKeepIdle, "API_SESSION_KEEP_IDLE", 14 * 24 * time.Hour},
		{&c.RecentSignIn, "API_RECENT_SIGN_IN", 12 * time.Hour},
		{&c.LoginRateInterval, "API_LOGIN_RATE_INTERVAL", time.Minute},
		{&c.LoginEmailInterval, "API_LOGIN_EMAIL_INTERVAL", 15 * time.Minute},
		{&c.AuthEventsRetention, "API_AUTH_EVENTS_RETENTION", 180 * 24 * time.Hour},
		{&c.AuditRetention, "API_AUDIT_RETENTION", 3653 * 24 * time.Hour},
		{&c.ConfirmTTL, "API_CONFIRM_TTL", 7 * 24 * time.Hour},
	} {
		if *d.dst, err = envDuration(d.key, d.def); err != nil {
			return c, err
		}
	}

	fs := flag.NewFlagSet("api", flag.ContinueOnError)
	fs.StringVar(&c.Addr, "addr", c.Addr, "listen address")
	fs.BoolVar(&c.SeedAdmin, "seed-admin", false, "create the first admin from API_SEED_USER_* and exit")
	fs.BoolVar(&c.SeedDemo, "seed-demo", false, "fill an empty database with demo data as the API_SEED_USER_EMAIL admin and exit")
	fs.BoolVar(&c.Healthcheck, "healthcheck", false, "check that the API at -addr is ready (GET /ready) and exit")
	if err := fs.Parse(args); err != nil {
		return c, err
	}
	return c, nil
}

func (c config) validate() error {
	// The probe needs only Addr, which loadConfig has already parsed.
	if c.Healthcheck {
		return nil
	}
	var errs []error
	if c.DBDSN == "" {
		errs = append(errs, errors.New("API_DB_DSN is required"))
	}
	if c.DBMaxConns < 1 {
		errs = append(errs, errors.New("API_DB_MAX_CONNS must be at least 1"))
	}
	if c.SeedAdmin {
		if c.SeedUserEmail == "" || c.SeedUserPassword == "" {
			errs = append(errs, errors.New("-seed-admin needs API_SEED_USER_EMAIL and API_SEED_USER_PASSWORD"))
		}
		return errors.Join(errs...)
	}
	if c.SeedDemo {
		if c.SeedUserEmail == "" {
			errs = append(errs, errors.New("-seed-demo needs API_SEED_USER_EMAIL (the admin the data is created as)"))
		}
		return errors.Join(errs...)
	}
	// HS256 with a short secret is brute-forceable offline from any issued token.
	if len(c.JWTSecret) < 32 {
		errs = append(errs, errors.New("API_JWT_SECRET must be at least 32 bytes"))
	}
	if c.JWTTTL < time.Minute || c.JWTTTL > 24*time.Hour {
		errs = append(errs, errors.New("API_JWT_TTL must be between 1m and 24h"))
	}
	if c.SessionMaxAge < c.JWTTTL || c.SessionMaxAge > 30*24*time.Hour {
		errs = append(errs, errors.New("API_SESSION_MAX_AGE must be at least API_JWT_TTL and at most 720h"))
	}
	if c.SessionKeepMaxAge < c.SessionMaxAge || c.SessionKeepMaxAge > 90*24*time.Hour {
		errs = append(errs, errors.New("API_SESSION_KEEP_MAX_AGE must be at least API_SESSION_MAX_AGE and at most 2160h"))
	}
	if c.SessionKeepIdle < c.JWTTTL || c.SessionKeepIdle > c.SessionKeepMaxAge {
		errs = append(errs, errors.New("API_SESSION_KEEP_IDLE must be at least API_JWT_TTL and at most API_SESSION_KEEP_MAX_AGE"))
	}
	if c.RecentSignIn < 5*time.Minute || c.RecentSignIn > c.SessionKeepMaxAge {
		errs = append(errs, errors.New("API_RECENT_SIGN_IN must be at least 5m and at most API_SESSION_KEEP_MAX_AGE"))
	}
	if c.LoginRateLimit < 1 || c.LoginRateInterval <= 0 {
		errs = append(errs, errors.New("API_LOGIN_RATE_LIMIT and API_LOGIN_RATE_INTERVAL must be positive"))
	}
	if c.LoginEmailFailures < 1 || c.LoginEmailInterval <= 0 || c.LoginEmailInterval > 24*time.Hour {
		errs = append(errs, errors.New("API_LOGIN_EMAIL_FAILURES must be positive and API_LOGIN_EMAIL_INTERVAL positive and at most 24h"))
	}
	// The table's trigger refuses to delete rows younger than 30 days.
	if c.AuthEventsRetention < 30*24*time.Hour || c.AuthEventsRetention > 3*365*24*time.Hour {
		errs = append(errs, errors.New("API_AUTH_EVENTS_RETENTION must be between 720h and 26280h"))
	}
	// purge_audit_events refuses anything younger than 365 days.
	if c.AuditRetention < 366*24*time.Hour || c.AuditRetention > 20*366*24*time.Hour {
		errs = append(errs, errors.New("API_AUDIT_RETENTION must be between 8784h (366 days) and 175680h (20 years)"))
	}
	if c.MetricsAddr != "" && c.MetricsAddr == c.Addr {
		errs = append(errs, errors.New("API_METRICS_ADDR must differ from API_ADDR"))
	}
	if c.RequestTimeout <= 0 {
		errs = append(errs, errors.New("API_REQUEST_TIMEOUT must be positive"))
	}
	if u, err := url.Parse(c.PublicBaseURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		errs = append(errs, errors.New("API_PUBLIC_BASE_URL must be an absolute http(s) URL"))
	}
	if c.ConfirmTTL < time.Minute || c.ConfirmTTL > 90*24*time.Hour {
		errs = append(errs, errors.New("API_CONFIRM_TTL must be between 1m and 2160h"))
	}
	if _, err := c.location(); err != nil {
		errs = append(errs, fmt.Errorf("API_ORG_TIMEZONE: %w", err))
	}
	return errors.Join(errs...)
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) (int, error) {
	v := env(key, "")
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return n, nil
}

func envDuration(key string, def time.Duration) (time.Duration, error) {
	v := env(key, "")
	if v == "" {
		return def, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return d, nil
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// location loads OrgTimezone; validate has already checked it loads.
func (c config) location() (*time.Location, error) {
	return time.LoadLocation(c.OrgTimezone)
}
