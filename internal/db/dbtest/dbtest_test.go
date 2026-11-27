package dbtest

import (
	"context"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/remisb/ppe-next2/internal/db"
)

func TestCloneName(t *testing.T) {
	name := cloneName()
	if len(name) > 63 || !regexp.MustCompile(`^ppe2_t_[a-z0-9_]+_[0-9a-f]{8}$`).MatchString(name) {
		t.Fatalf("cloneName() = %q", name)
	}
	if !strings.HasPrefix(name, "ppe2_t_dbtest_") {
		t.Errorf("cloneName() = %q, want it named after the package", name)
	}
	tmpl, err := templateName()
	if err != nil || !regexp.MustCompile(`^ppe2_tmpl_[0-9a-f]{12}$`).MatchString(tmpl) {
		t.Fatalf("templateName() = %q, %v", tmpl, err)
	}
}

// The package's database is cloned once per test binary, holds every
// migration, and is not API_TEST_DB_DSN's own.
func TestPostgresDSNClonesTheTemplateOnce(t *testing.T) {
	dsn := DSN(t)
	if again := DSN(t); again != dsn {
		t.Fatalf("second DSN = %q, first %q", again, dsn)
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	base, _ := url.Parse(os.Getenv("API_TEST_DB_DSN"))
	if u.Path == base.Path || u.Path != "/"+cloneName() {
		t.Fatalf("database %q (API_TEST_DB_DSN's %q)", u.Path, base.Path)
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	var n int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != len(db.Migrations()) {
		t.Fatalf("schema_migrations has %d rows, want %d", n, len(db.Migrations()))
	}
	if !appSignsIn(ctx, dsn) {
		t.Error("ppe_app cannot sign in to the clone")
	}
}
