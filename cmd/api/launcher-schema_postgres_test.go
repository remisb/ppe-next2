package main

import (
	"context"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/applauncher"
	"github.com/remisb/applauncher/launcher"

	"github.com/remisb/ppe-next2/internal/db/dbtest"
)

// This site's migrations (0042 to 0068) and App Launcher's own
// (applauncher.Migrations) make the same schema launcher, but for the
// foreign keys to users that this site adds: the module's code, its error
// mapping by constraint name and its later migrations rely on it. The
// module's SQL runs in a transaction beside this site's schema, renamed for
// the moment, and is rolled back.
func TestPostgresLauncherSchemaIsTheModules(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dbtest.DSN(t))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		site, err := launcherSchema(ctx, tx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `ALTER SCHEMA launcher RENAME TO launcher_site`); err != nil {
			return err
		}
		for _, name := range applauncher.Migrations() {
			sql, err := applauncher.SQL(name)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, sql); err != nil {
				t.Errorf("the module's %s: %v", name, err)
				return nil
			}
		}
		module, err := launcherSchema(ctx, tx)
		if err != nil {
			return err
		}
		if len(site) < 40 || len(module) < 40 {
			t.Errorf("read %d lines of this site's schema and %d of the module's", len(site), len(module))
		}
		usersKey := regexp.MustCompile(`FOREIGN KEY \(\w+\) REFERENCES (public\.)?users\(id\)`)
		site = slices.DeleteFunc(site, func(s string) bool { return usersKey.MatchString(s) })
		for _, s := range site {
			if !slices.Contains(module, s) {
				t.Errorf("only this site's schema has %s", s)
			}
		}
		for _, s := range module {
			if !slices.Contains(site, s) {
				t.Errorf("only the module's schema has %s", s)
			}
		}
		return pgx.ErrTxClosed // roll back
	})
	if err != nil && err != pgx.ErrTxClosed {
		t.Fatal(err)
	}
}

// launcherSchema lists schema launcher's columns, constraints and indexes,
// one line each, sorted.
func launcherSchema(ctx context.Context, tx pgx.Tx) ([]string, error) {
	rows, err := tx.Query(ctx, `
		SELECT 'column ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
			|| CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
			|| coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
		FROM pg_attribute a
		JOIN pg_class c ON c.oid = a.attrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE n.nspname = 'launcher' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
			AND c.relname <> 'schema_migrations'
		UNION ALL
		SELECT 'constraint ' || c.relname || '.' || k.conname || ' ' || pg_get_constraintdef(k.oid)
		FROM pg_constraint k
		JOIN pg_class c ON c.oid = k.conrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'launcher' AND c.relname <> 'schema_migrations'
		UNION ALL
		SELECT 'index ' || pg_get_indexdef(i.indexrelid)
		FROM pg_index i
		JOIN pg_class c ON c.oid = i.indexrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'launcher' AND c.relname NOT LIKE 'schema_migrations%'`)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	for i, s := range out {
		out[i] = strings.ReplaceAll(s, "launcher_site.", "launcher.")
	}
	slices.Sort(out)
	return out, nil
}

// Manage apps and make new-app check a slug as the API does
// (@ppe/api-client's app-slugs.ts, the module's launcher.SlugPattern).
func TestWebClientKeepsTheSlugRule(t *testing.T) {
	src, err := os.ReadFile("../../web/packages/api-client/src/app-slugs.ts")
	if err != nil {
		t.Fatal(err)
	}
	pattern := regexp.MustCompile(`APP_SLUG_PATTERN = /(.+)/\n`).FindSubmatch(src)
	if pattern == nil || string(pattern[1]) != launcher.SlugPattern() {
		t.Errorf("app-slugs.ts's APP_SLUG_PATTERN is %q, the API's %q", pattern, launcher.SlugPattern())
	}
	list := regexp.MustCompile(`RESERVED_APP_SLUGS: readonly string\[\] = \[(.*?)\]`).FindSubmatch(src)
	if list == nil {
		t.Fatal("no RESERVED_APP_SLUGS list in app-slugs.ts")
	}
	var web []string
	for _, m := range regexp.MustCompile(`'([^']+)'`).FindAllSubmatch(list[1], -1) {
		web = append(web, string(m[1]))
	}
	if !slices.Equal(web, launcher.ReservedSlugs) {
		t.Errorf("app-slugs.ts reserves %v, the API %v", web, launcher.ReservedSlugs)
	}
}
