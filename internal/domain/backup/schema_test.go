package backup

import (
	"os"
	"testing"

	dbpg "github.com/remisb/dbbackup/postgres"
)

// The agent writes the tables this package reads, in the shape of the
// dbbackup version go.mod names. Migration 0019 is that schema copied
// verbatim; a dbbackup upgrade that changes it needs a new migration first.
func TestMigrationMatchesLibrarySchema(t *testing.T) {
	b, err := os.ReadFile("../../db/migrations/0019_backups.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != dbpg.Schema {
		t.Fatalf("0019_backups.up.sql differs from dbbackup postgres.Schema v%d: add a migration for the new schema", dbpg.SchemaVersion)
	}
}
