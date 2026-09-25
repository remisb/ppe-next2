package main

import (
	"strings"
	"testing"
	"time"
)

func TestConfigValidate(t *testing.T) {
	ok := config{
		DBDSN: "postgres://x", DBMaxConns: 1, JWTSecret: strings.Repeat("s", 32), JWTTTL: 15 * time.Minute,
		LoginRateLimit: 5, LoginRateInterval: time.Minute, RequestTimeout: time.Second, OrgTimezone: "Europe/Vilnius",
		PublicBaseURL: "http://localhost:5180", ConfirmTTL: time.Hour,
	}
	if err := ok.validate(); err != nil {
		t.Fatalf("valid config: %v", err)
	}
	for name, mutate := range map[string]func(*config){
		"no dsn":       func(c *config) { c.DBDSN = "" },
		"short secret": func(c *config) { c.JWTSecret = "short" },
		"ttl too long": func(c *config) { c.JWTTTL = 48 * time.Hour },
		"no rate":      func(c *config) { c.LoginRateLimit = 0 },
		"bad timezone": func(c *config) { c.OrgTimezone = "Mars/Olympus" },
		"relative url": func(c *config) { c.PublicBaseURL = "/confirm" },
		"zero ttl":     func(c *config) { c.ConfirmTTL = 0 },
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
}

// TestLoadConfigDefaults loads the real defaults, so a setting added to the
// struct but not read in loadConfig fails here rather than at startup.
func TestLoadConfigDefaults(t *testing.T) {
	for _, k := range []string{"API_PUBLIC_BASE_URL", "API_CONFIRM_TTL", "API_ORG_TIMEZONE", "API_JWT_TTL"} {
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
	if c.PublicBaseURL != "http://localhost:5180" || c.ConfirmTTL != 7*24*time.Hour || c.OrgTimezone != "Europe/Vilnius" {
		t.Errorf("defaults = %+v", c)
	}
	t.Setenv("API_PUBLIC_BASE_URL", "https://work.example.com/")
	t.Setenv("API_ORG_TIMEZONE", "Europe/Riga")
	c, _ = loadConfig(nil)
	if c.PublicBaseURL != "https://work.example.com" || c.OrgTimezone != "Europe/Riga" {
		t.Errorf("overrides = %q %q", c.PublicBaseURL, c.OrgTimezone)
	}
}
