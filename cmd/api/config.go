package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"math"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/personnel/document"
	"github.com/remisb/ppe-next2/internal/sealbox"
)

type config struct {
	Addr            string
	DBDSN           string
	DBMaxConns      int
	RequestTimeout  time.Duration
	ShutdownTimeout time.Duration

	JWTSecret string
	JWTIssuer string
	// SIMCodesKey seals SIM cards' PIN and PUK (internal/sealbox): 64 hex
	// characters, kept apart from the database and its backups (ADR 0005).
	// SIMCodesKeyID names it on each row it seals; SIMCodesPreviousKeys
	// ("id:hex,…") only open, while a key change seals everything again
	// (ResealSIMCodes, docs/backups.md).
	SIMCodesKey          string
	SIMCodesKeyID        int
	SIMCodesPreviousKeys string
	// PersonnelKey seals each person's data key in Personnel files (ADR 0007),
	// with PersonnelKeyID and PersonnelPreviousKeys as the SIM codes key has;
	// PersonnelIndexKey is the blind indexes' HMAC key. Both or neither: without
	// them Personnel files' routes answer that it is not configured.
	PersonnelKey          string
	PersonnelKeyID        int
	PersonnelPreviousKeys string
	PersonnelIndexKey     string
	// PersonnelRetentionMonths is how long after employment ends a personnel
	// file is kept before the upkeep shreds it (D3: Lithuania's personal-file
	// period, 3 years).
	PersonnelRetentionMonths int
	// SecretsKey seals the secrets an administrator enters in Settings, first
	// the OpenAI API key (ADR 0007): 64 hex, with SecretsKeyID and
	// SecretsPreviousKeys as the SIM codes key has. Optional: without it no
	// key can be saved, and Settings → AI says so.
	SecretsKey          string
	SecretsKeyID        int
	SecretsPreviousKeys string
	// OpenAIBaseURL is where OpenAI's API is: https://api.openai.com, or a
	// test's fake (the e2e suite's).
	OpenAIBaseURL string
	JWTTTL        time.Duration
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
	// AuditTSAURL is the timestamp service (RFC 3161) that anchors each
	// day's audit seal outside the database; empty stamps nothing.
	AuditTSAURL string
	// FilesTarget is where uploaded files (signed copies) are kept:
	// s3://bucket/prefix?endpoint=host&region=r (Spaces, with FilesAccessKey
	// and FilesSecretKey) or file:///folder for development; empty keeps none,
	// and uploads are refused.
	FilesTarget    string
	FilesAccessKey string
	FilesSecretKey string
	// AppsDir holds the builds of apps published under /apps/<slug>/ (ADR 0006,
	// phase 3): <profile>/<slug>/<version>/, which Caddy serves; empty
	// publishes and serves none.
	AppsDir        string
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

	// VerifyAudit checks the Audit log against its seals, prints what it
	// found and exits; non-zero on a mismatch. For the restore drill.
	VerifyAudit bool

	// Upkeep runs the hourly upkeep once (purges, samples, audit seals and
	// their check) and exits; non-zero when a part failed.
	Upkeep bool

	// ImportSIMs is the SIM card list (CSV) to import as the
	// API_SEED_USER_EMAIL user; the import checks it and writes nothing
	// unless ImportCommit is set.
	ImportSIMs   string
	ImportCommit bool

	// PublishApp is the slug of the app whose build (a tar of its dist/ on
	// standard input) is published as PublishVersion into AppsDir, pointing
	// PublishChannel at it; PublishCommit is the commit it was built from.
	PublishApp     string
	PublishVersion string
	PublishChannel string
	PublishCommit  string
	// PruneApps removes published versions no channel points at beyond each
	// app's newest launcher.KeepVersions, files and all, and exits.
	PruneApps bool

	// ResealSIMCodes seals every SIM card's PIN and PUK kept under a
	// previous key again under API_SIM_CODES_KEY, prints what it did and
	// exits; non-zero when some did not open.
	ResealSIMCodes bool
}

// loadConfig reads env vars, then lets flags override the non-secret ones.
// Secrets (JWT secret, seed password) have no flag so they never appear in ps.
func loadConfig(args []string) (config, error) {
	c := config{
		Addr:             env("API_ADDR", ":8090"),
		DBDSN:            env("API_DB_DSN", ""),
		JWTSecret:        env("API_JWT_SECRET", ""),
		JWTIssuer:        env("API_JWT_ISSUER", "ppe-next2"),
		SIMCodesKey:      env("API_SIM_CODES_KEY", ""),
		SeedUserEmail:    env("API_SEED_USER_EMAIL", ""),
		SeedUserPassword: env("API_SEED_USER_PASSWORD", ""),
		SeedUserName:     env("API_SEED_USER_NAME", "Administrator"),
		AllowedOrigins:   splitList(env("API_ALLOWED_ORIGINS", "")),
		OrgTimezone:      env("API_ORG_TIMEZONE", "Europe/Vilnius"),
		PublicBaseURL:    strings.TrimRight(env("API_PUBLIC_BASE_URL", "http://localhost:5180"), "/"),
		MetricsAddr:      env("API_METRICS_ADDR", ""),
		AuditTSAURL:      env("API_AUDIT_TSA_URL", ""),
		FilesTarget:      env("API_FILES_TARGET", ""),
		FilesAccessKey:   env("API_FILES_S3_ACCESS_KEY", ""),
		FilesSecretKey:   env("API_FILES_S3_SECRET_KEY", ""),
		AppsDir:          env("API_APPS_DIR", ""),
	}
	var err error
	if c.TrustedProxies, err = middleware.ParseTrustedProxies(splitList(env("API_TRUSTED_PROXIES", ""))); err != nil {
		return c, fmt.Errorf("API_TRUSTED_PROXIES: %w", err)
	}
	c.SIMCodesPreviousKeys = env("API_SIM_CODES_PREVIOUS_KEYS", "")
	if c.SIMCodesKeyID, err = envInt("API_SIM_CODES_KEY_ID", 1); err != nil {
		return c, err
	}
	c.PersonnelKey = env("API_PERSONNEL_KEY", "")
	c.PersonnelPreviousKeys = env("API_PERSONNEL_PREVIOUS_KEYS", "")
	c.PersonnelIndexKey = env("API_PERSONNEL_INDEX_KEY", "")
	if c.PersonnelKeyID, err = envInt("API_PERSONNEL_KEY_ID", 1); err != nil {
		return c, err
	}
	if c.PersonnelRetentionMonths, err = envInt("API_PERSONNEL_RETENTION_MONTHS", 36); err != nil {
		return c, err
	}
	c.SecretsKey = env("API_SECRETS_KEY", "")
	c.OpenAIBaseURL = strings.TrimRight(env("API_OPENAI_BASE_URL", "https://api.openai.com"), "/")
	c.SecretsPreviousKeys = env("API_SECRETS_PREVIOUS_KEYS", "")
	if c.SecretsKeyID, err = envInt("API_SECRETS_KEY_ID", 1); err != nil {
		return c, err
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
	fs.BoolVar(&c.VerifyAudit, "verify-audit", false, "verify the Audit log against its seals, print the result as JSON and exit")
	fs.BoolVar(&c.Upkeep, "upkeep", false, "run the hourly upkeep once (purges, samples, audit seals) and exit")
	fs.StringVar(&c.ImportSIMs, "import-sims", "", "check the SIM card list at this CSV path (- for standard input), print what it would import and exit")
	fs.BoolVar(&c.ImportCommit, "commit", false, "with -import-sims: import the SIM cards")
	fs.StringVar(&c.PublishApp, "publish-app", "", "publish this app's build (a tar of its dist/ on standard input) into API_APPS_DIR and exit")
	fs.StringVar(&c.PublishVersion, "version", "", "with -publish-app: the version, YYYY.MM.DD-<commit>")
	fs.StringVar(&c.PublishChannel, "channel", "", "with -publish-app: the channel to point at it (stable, beta or preview)")
	fs.StringVar(&c.PublishCommit, "from-commit", "", "with -publish-app: the commit it was built from")
	fs.BoolVar(&c.PruneApps, "prune-apps", false, "remove published versions no channel points at, beyond each app's newest, and exit")
	fs.BoolVar(&c.ResealSIMCodes, "reseal-sim-codes", false, "seal every SIM card's PIN and PUK kept under a previous key again under API_SIM_CODES_KEY, print the counts and exit")
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
	if c.VerifyAudit || c.Upkeep {
		return errors.Join(errs...)
	}
	if c.ResealSIMCodes {
		errs = append(errs, c.simCodesKeyErrors()...)
		return errors.Join(errs...)
	}
	if c.PruneApps {
		if c.AppsDir == "" {
			errs = append(errs, errors.New("-prune-apps needs API_APPS_DIR"))
		}
		return errors.Join(errs...)
	}
	if c.PublishApp != "" {
		if c.AppsDir == "" {
			errs = append(errs, errors.New("-publish-app needs API_APPS_DIR"))
		}
		if c.PublishVersion == "" {
			errs = append(errs, errors.New("-publish-app needs -version"))
		}
		return errors.Join(errs...)
	}
	if c.PublishVersion != "" || c.PublishChannel != "" || c.PublishCommit != "" {
		errs = append(errs, errors.New("-version, -channel and -from-commit are for -publish-app"))
	}
	if c.ImportCommit && c.ImportSIMs == "" {
		errs = append(errs, errors.New("-commit is for -import-sims"))
	}
	if c.ImportSIMs != "" {
		if c.SeedUserEmail == "" {
			errs = append(errs, errors.New("-import-sims needs API_SEED_USER_EMAIL (the user the import is recorded as)"))
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
	errs = append(errs, c.simCodesKeyErrors()...)
	errs = append(errs, c.personnelKeyErrors()...)
	errs = append(errs, c.secretsKeyErrors()...)
	if u, err := url.Parse(c.OpenAIBaseURL); c.OpenAIBaseURL != "" && (err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "") {
		errs = append(errs, errors.New("API_OPENAI_BASE_URL must be an http(s) address"))
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
	if c.AuditTSAURL != "" {
		if u, err := url.Parse(c.AuditTSAURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			errs = append(errs, errors.New("API_AUDIT_TSA_URL must be empty or an absolute http(s) URL"))
		}
	}
	if err := files.Check(c.FilesTarget, c.FilesAccessKey, c.FilesSecretKey); err != nil {
		errs = append(errs, fmt.Errorf("API_FILES_TARGET: %w", err))
	}
	if c.AppsDir != "" {
		if fi, err := os.Stat(c.AppsDir); err != nil || !fi.IsDir() {
			errs = append(errs, errors.New("API_APPS_DIR must be empty or an existing folder"))
		}
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

// personnelKeyErrors checks Personnel files' keys (ADR 0007): none, or the
// master key with its id and previous keys and the index key, each its own.
func (c config) personnelKeyErrors() []error {
	if c.PersonnelKey == "" && c.PersonnelIndexKey == "" && c.PersonnelPreviousKeys == "" {
		return nil
	}
	var errs []error
	key, err := sealbox.ParseKey(c.PersonnelKey)
	if err != nil {
		errs = append(errs, fmt.Errorf("API_PERSONNEL_KEY %w", err))
	}
	index, err := sealbox.ParseKey(c.PersonnelIndexKey)
	if err != nil {
		errs = append(errs, fmt.Errorf("API_PERSONNEL_INDEX_KEY %w", err))
	}
	others := map[string]string{"API_JWT_SECRET": c.JWTSecret, "API_SIM_CODES_KEY": c.SIMCodesKey}
	for name, v := range others {
		if v != "" && (v == c.PersonnelKey || v == c.PersonnelIndexKey) {
			errs = append(errs, fmt.Errorf("Personnel files' keys must not be %s", name))
		}
	}
	if key != nil && index != nil && bytes.Equal(key, index) {
		errs = append(errs, errors.New("API_PERSONNEL_INDEX_KEY must not be API_PERSONNEL_KEY"))
	}
	if c.PersonnelRetentionMonths < 12 || c.PersonnelRetentionMonths > 1200 {
		errs = append(errs, errors.New("API_PERSONNEL_RETENTION_MONTHS must be from 12 to 1200"))
	}
	if c.PersonnelKeyID < 1 || c.PersonnelKeyID > math.MaxInt16 {
		errs = append(errs, fmt.Errorf("API_PERSONNEL_KEY_ID must be from 1 to %d", math.MaxInt16))
	}
	previous, err := sealbox.ParseKeys(c.PersonnelPreviousKeys)
	if err != nil {
		return append(errs, fmt.Errorf("API_PERSONNEL_PREVIOUS_KEYS %w", err))
	}
	for id, k := range previous {
		if int(id) == c.PersonnelKeyID {
			errs = append(errs, fmt.Errorf("API_PERSONNEL_PREVIOUS_KEYS has key %d, which is API_PERSONNEL_KEY_ID: a previous key needs an id of its own", id))
		}
		if key != nil && bytes.Equal(k, key) {
			errs = append(errs, fmt.Errorf("API_PERSONNEL_PREVIOUS_KEYS key %d is API_PERSONNEL_KEY", id))
		}
	}
	return errs
}

// secretsKeyErrors checks the Settings secrets' keyring: none, or the key
// with its id and previous keys, none of them another key here.
func (c config) secretsKeyErrors() []error {
	if c.SecretsKey == "" && c.SecretsPreviousKeys == "" {
		return nil
	}
	var errs []error
	key, err := sealbox.ParseKey(c.SecretsKey)
	if err != nil {
		errs = append(errs, fmt.Errorf("API_SECRETS_KEY %w", err))
	}
	for name, v := range map[string]string{"API_JWT_SECRET": c.JWTSecret, "API_SIM_CODES_KEY": c.SIMCodesKey, "API_PERSONNEL_KEY": c.PersonnelKey, "API_PERSONNEL_INDEX_KEY": c.PersonnelIndexKey} {
		if v != "" && v == c.SecretsKey {
			errs = append(errs, fmt.Errorf("API_SECRETS_KEY must not be %s", name))
		}
	}
	if c.SecretsKeyID < 1 || c.SecretsKeyID > math.MaxInt16 {
		errs = append(errs, fmt.Errorf("API_SECRETS_KEY_ID must be from 1 to %d", math.MaxInt16))
	}
	previous, err := sealbox.ParseKeys(c.SecretsPreviousKeys)
	if err != nil {
		return append(errs, fmt.Errorf("API_SECRETS_PREVIOUS_KEYS %w", err))
	}
	for id, k := range previous {
		if int(id) == c.SecretsKeyID {
			errs = append(errs, fmt.Errorf("API_SECRETS_PREVIOUS_KEYS has key %d, which is API_SECRETS_KEY_ID", id))
		}
		if key != nil && bytes.Equal(k, key) {
			errs = append(errs, fmt.Errorf("API_SECRETS_PREVIOUS_KEYS key %d is API_SECRETS_KEY", id))
		}
	}
	return errs
}

// secretsKeyring is the Settings secrets' keyring, or nil without API_SECRETS_KEY.
func secretsKeyring(cfg config) (*sealbox.Keyring, error) {
	if cfg.SecretsKey == "" {
		return nil, nil
	}
	key, err := sealbox.ParseKey(cfg.SecretsKey)
	if err != nil {
		return nil, fmt.Errorf("API_SECRETS_KEY %w", err)
	}
	keys, err := sealbox.ParseKeys(cfg.SecretsPreviousKeys)
	if err != nil {
		return nil, fmt.Errorf("API_SECRETS_PREVIOUS_KEYS %w", err)
	}
	keys[int16(cfg.SecretsKeyID)] = key
	return sealbox.NewKeyring(int16(cfg.SecretsKeyID), keys)
}

// personnelKeys are Personnel files' keys, validate having checked them; the
// zero Keys (Personnel files off) when none is set.
func personnelKeys(cfg config) (document.Keys, error) {
	if cfg.PersonnelKey == "" {
		return document.Keys{}, nil
	}
	key, err := sealbox.ParseKey(cfg.PersonnelKey)
	if err != nil {
		return document.Keys{}, fmt.Errorf("API_PERSONNEL_KEY %w", err)
	}
	keys, err := sealbox.ParseKeys(cfg.PersonnelPreviousKeys)
	if err != nil {
		return document.Keys{}, fmt.Errorf("API_PERSONNEL_PREVIOUS_KEYS %w", err)
	}
	keys[int16(cfg.PersonnelKeyID)] = key
	master, err := sealbox.NewKeyring(int16(cfg.PersonnelKeyID), keys)
	if err != nil {
		return document.Keys{}, err
	}
	index, err := sealbox.ParseKey(cfg.PersonnelIndexKey)
	if err != nil {
		return document.Keys{}, fmt.Errorf("API_PERSONNEL_INDEX_KEY %w", err)
	}
	return document.Keys{Master: master, Index: index}, nil
}

// location loads OrgTimezone; validate has already checked it loads.
func (c config) location() (*time.Location, error) {
	return time.LoadLocation(c.OrgTimezone)
}

// simCodesKeyErrors checks the SIM codes keys: the current one, its id and
// the previous ones (ADR 0005, docs/backups.md "Changing the SIM codes key").
func (c config) simCodesKeyErrors() []error {
	var errs []error
	if _, err := sealbox.ParseKey(c.SIMCodesKey); err != nil {
		errs = append(errs, fmt.Errorf("API_SIM_CODES_KEY %w", err))
	} else if c.SIMCodesKey == c.JWTSecret {
		errs = append(errs, errors.New("API_SIM_CODES_KEY must not be API_JWT_SECRET"))
	}
	if c.SIMCodesKeyID < 1 || c.SIMCodesKeyID > math.MaxInt16 {
		errs = append(errs, fmt.Errorf("API_SIM_CODES_KEY_ID must be from 1 to %d", math.MaxInt16))
	}
	previous, err := sealbox.ParseKeys(c.SIMCodesPreviousKeys)
	if err != nil {
		return append(errs, fmt.Errorf("API_SIM_CODES_PREVIOUS_KEYS %w", err))
	}
	current, _ := sealbox.ParseKey(c.SIMCodesKey)
	for id, key := range previous {
		if int(id) == c.SIMCodesKeyID {
			errs = append(errs, fmt.Errorf("API_SIM_CODES_PREVIOUS_KEYS has key %d, which is API_SIM_CODES_KEY_ID: a previous key needs an id of its own", id))
		}
		if current != nil && bytes.Equal(key, current) {
			errs = append(errs, fmt.Errorf("API_SIM_CODES_PREVIOUS_KEYS key %d is API_SIM_CODES_KEY", id))
		}
	}
	return errs
}
