// Package dbtest gives each Go test package a database of its own (DSN) and
// connects Postgres tests as the API's own role, ppe_app (migration 0026),
// so they exercise its grants as production does (AppPool). Setup that
// empties tables keeps the owner's connection (DSN's).
package dbtest

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/db"
)

// appPassword is ppe_app's password in test databases only.
const appPassword = "ppe-app-test"

// lockKey is the advisory lock ("PPED") held, on the server's postgres
// database, while a template is built or a package's database cloned. It
// differs from testlock.Key, which e2e runs hold for their whole length.
const lockKey int64 = 0x50504544

var (
	once     sync.Once
	cloneDSN string
	cloneErr error
)

// DSN is the test package's own database, skipping the test when
// API_TEST_DB_DSN is unset. The first call in a test binary drops and
// clones it from a template holding every migration and grants.sql (built
// once per set of migrations, on API_TEST_DB_DSN's server as its user, which
// must be allowed to create databases), so packages run in parallel without
// sharing data. The database is named after the package and the directory
// the test runs in, so two worktrees running one package keep apart and a
// rerun replaces it; `make db-test-clean` drops them all.
func DSN(t testing.TB) string {
	t.Helper()
	base := os.Getenv("API_TEST_DB_DSN")
	if base == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	once.Do(func() { cloneDSN, cloneErr = prepare(base) })
	if cloneErr != nil {
		t.Fatalf("dbtest: %v", cloneErr)
	}
	return cloneDSN
}

// prepare builds the template if it is missing and clones the package's
// database from it, under lockKey, returning the clone's DSN.
func prepare(base string) (string, error) {
	u, err := url.Parse(base)
	if err != nil {
		return "", fmt.Errorf("API_TEST_DB_DSN: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	admin, err := pgx.Connect(ctx, withDatabase(u, "postgres"))
	if err != nil {
		return "", fmt.Errorf("connect to the server's postgres database: %w", err)
	}
	defer admin.Close(context.Background())
	if _, err := admin.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockKey); err != nil {
		return "", fmt.Errorf("lock: %w", err)
	}
	// Closing the connection frees the lock too, should the unlock fail.
	defer func() { _, _ = admin.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockKey) }()

	tmpl, err := templateName()
	if err != nil {
		return "", err
	}
	var exists bool
	if err := admin.QueryRow(ctx, `SELECT EXISTS (SELECT FROM pg_database WHERE datname = $1)`, tmpl).Scan(&exists); err != nil {
		return "", err
	}
	if !exists {
		if err := buildTemplate(ctx, admin, u, tmpl); err != nil {
			return "", fmt.Errorf("build %s: %w", tmpl, err)
		}
	}

	clone := cloneName()
	if _, err := admin.Exec(ctx, `DROP DATABASE IF EXISTS `+ident(clone)+` WITH (FORCE)`); err != nil {
		return "", fmt.Errorf("drop %s: %w", clone, err)
	}
	if _, err := admin.Exec(ctx, `CREATE DATABASE `+ident(clone)+` TEMPLATE `+ident(tmpl)); err != nil {
		return "", fmt.Errorf("clone %s: %w", clone, err)
	}
	dsn := withDatabase(u, clone)
	// ppe_app is the server's, not a database's: give it the test password
	// here, under the lock, unless it already signs in with it, so that
	// packages running at once never alter the role together.
	if !appSignsIn(ctx, dsn) {
		if _, err := admin.Exec(ctx, `ALTER ROLE ppe_app WITH LOGIN PASSWORD '`+appPassword+`'`); err != nil {
			return "", fmt.Errorf("ppe_app: %w", err)
		}
	}
	return dsn, nil
}

// buildTemplate applies what `make migrate` applies to a new database under
// a name of its own and renames it to tmpl only once all of it is in, so a
// half-built template never goes by tmpl's name.
func buildTemplate(ctx context.Context, admin *pgx.Conn, u *url.URL, tmpl string) error {
	// Builds a crashed run left behind; no one else builds while we hold the lock.
	rows, err := admin.Query(ctx, `SELECT datname FROM pg_database WHERE datname LIKE 'ppe2\_tmpl\_%\_build\_%'`)
	if err != nil {
		return err
	}
	stale, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, name := range stale {
		if _, err := admin.Exec(ctx, `DROP DATABASE IF EXISTS `+ident(name)+` WITH (FORCE)`); err != nil {
			return err
		}
	}

	build := tmpl + "_build_" + randomHex(4)
	if _, err := admin.Exec(ctx, `CREATE DATABASE `+ident(build)); err != nil {
		return err
	}
	if err := migrate(ctx, withDatabase(u, build)); err != nil {
		_, _ = admin.Exec(context.Background(), `DROP DATABASE IF EXISTS `+ident(build)+` WITH (FORCE)`)
		return err
	}
	_, err = admin.Exec(ctx, `ALTER DATABASE `+ident(build)+` RENAME TO `+ident(tmpl))
	return err
}

var fileName = regexp.MustCompile(`^[0-9a-z_]+\.up\.sql$`)

// migrate applies the bookkeeping file, each migration in a transaction
// with its schema_migrations row, then grants.sql, as `make migrate` does.
func migrate(ctx context.Context, dsn string) error {
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return err
	}
	// The files hold several statements each: the simple protocol runs them.
	cfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return err
	}
	defer conn.Close(context.Background())
	if _, err := conn.Exec(ctx, `SET client_min_messages = warning`); err != nil {
		return err
	}
	sql, err := db.UpSQL(db.Bookkeeping)
	if err != nil {
		return err
	}
	if _, err := conn.Exec(ctx, sql); err != nil {
		return fmt.Errorf("%s: %w", db.Bookkeeping, err)
	}
	for _, name := range db.Migrations() {
		if !fileName.MatchString(name) {
			return fmt.Errorf("unexpected migration name %q", name)
		}
		sql, err := db.UpSQL(name)
		if err != nil {
			return err
		}
		step := "BEGIN;\n" + sql + "\nINSERT INTO schema_migrations (filename) VALUES ('" + name + "');\nCOMMIT;"
		if _, err := conn.Exec(ctx, step); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	if _, err := conn.Exec(ctx, db.Grants()); err != nil {
		return fmt.Errorf("grants.sql: %w", err)
	}
	return nil
}

// templateName names the template after the migrations and grants it holds.
func templateName() (string, error) {
	h := sha256.New()
	for _, name := range append([]string{db.Bookkeeping}, db.Migrations()...) {
		sql, err := db.UpSQL(name)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(h, "%s\x00%s\x00", name, sql)
	}
	fmt.Fprintf(h, "grants.sql\x00%s", db.Grants())
	return "ppe2_tmpl_" + hex.EncodeToString(h.Sum(nil))[:12], nil
}

// cloneName is ppe2_t_<package>_<8 hex of the working directory's hash>.
func cloneName() string {
	pkg := filepath.Base(os.Args[0])
	pkg = strings.TrimSuffix(pkg, ".exe")
	pkg = strings.TrimSuffix(pkg, ".test")
	pkg = regexp.MustCompile(`[^a-z0-9_]`).ReplaceAllString(strings.ToLower(pkg), "_")
	wd, _ := os.Getwd()
	sum := sha256.Sum256([]byte(wd))
	suffix := "_" + hex.EncodeToString(sum[:])[:8]
	const prefix = "ppe2_t_"
	if room := 63 - len(prefix) - len(suffix); len(pkg) > room {
		pkg = pkg[:room]
	}
	return prefix + pkg + suffix
}

// appSignsIn tells whether ppe_app signs in to dsn's database with the test password.
func appSignsIn(ctx context.Context, dsn string) bool {
	u, err := url.Parse(dsn)
	if err != nil {
		return false
	}
	u.User = url.UserPassword("ppe_app", appPassword)
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, u.String())
	if err != nil {
		return false
	}
	conn.Close(context.Background())
	return true
}

func withDatabase(u *url.URL, name string) string {
	c := *u
	c.Path = "/" + name
	c.RawPath = ""
	return c.String()
}

func ident(name string) string { return pgx.Identifier{name}.Sanitize() }

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// AppPool lets ppe_app sign in with the test password (through owner, which
// may alter roles, unless it already can) and returns a pool connected as it
// to ownerDSN's database.
func AppPool(t *testing.T, owner *pgxpool.Pool, ownerDSN string) *pgxpool.Pool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if !appSignsIn(ctx, ownerDSN) {
		if _, err := owner.Exec(ctx, `ALTER ROLE ppe_app WITH LOGIN PASSWORD '`+appPassword+`'`); err != nil {
			t.Fatalf("ppe_app: %v", err)
		}
	}
	u, err := url.Parse(ownerDSN)
	if err != nil {
		t.Fatal(err)
	}
	u.User = url.UserPassword("ppe_app", appPassword)
	pool, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}
