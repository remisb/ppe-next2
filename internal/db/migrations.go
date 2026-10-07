// Package db holds the SQL migrations. `make migrate` and deploy/migrate.sh
// apply them; the API embeds their names to tell whether its database is up
// to date (GET /ready).
package db

import (
	"embed"
	"io/fs"
	"slices"
	"strings"
)

//go:embed migrations/*.up.sql
var migrations embed.FS

// bookkeeping is applied on every run and creates schema_migrations; it is
// the one file never recorded there.
const bookkeeping = "0000_schema_migrations.up.sql"

// Migrations are the *.up.sql file names this build expects in
// schema_migrations, in the order they are applied.
func Migrations() []string {
	entries, err := fs.ReadDir(migrations, "migrations")
	if err != nil {
		panic(err) // the embed pattern guarantees the directory
	}
	var names []string
	for _, e := range entries {
		if n := e.Name(); strings.HasSuffix(n, ".up.sql") && n != bookkeeping {
			names = append(names, n)
		}
	}
	slices.Sort(names)
	return names
}
