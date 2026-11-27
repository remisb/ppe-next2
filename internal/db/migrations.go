// Package db holds the SQL migrations. `make migrate` and deploy/migrate.sh
// apply them; the API embeds their names to tell whether its database is up
// to date (GET /ready), and dbtest applies them to build the Go tests'
// template database.
package db

import (
	"embed"
	"io/fs"
	"slices"
	"strings"
)

//go:embed migrations/*.up.sql
var migrations embed.FS

//go:embed grants.sql
var grants string

// Bookkeeping is applied first on every run and creates schema_migrations;
// it is the one file never recorded there.
const Bookkeeping = "0000_schema_migrations.up.sql"

// Migrations are the *.up.sql file names this build expects in
// schema_migrations, in the order they are applied.
func Migrations() []string {
	entries, err := fs.ReadDir(migrations, "migrations")
	if err != nil {
		panic(err) // the embed pattern guarantees the directory
	}
	var names []string
	for _, e := range entries {
		if n := e.Name(); strings.HasSuffix(n, ".up.sql") && n != Bookkeeping {
			names = append(names, n)
		}
	}
	slices.Sort(names)
	return names
}

// UpSQL is the content of the up file name: Bookkeeping or one of
// Migrations().
func UpSQL(name string) (string, error) {
	b, err := fs.ReadFile(migrations, "migrations/"+name)
	return string(b), err
}

// Grants is grants.sql, the API role's grants, applied after the migrations
// on every run.
func Grants() string { return grants }
