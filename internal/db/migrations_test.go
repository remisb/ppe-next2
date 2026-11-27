package db

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestMigrationsListEveryUpFileButBookkeeping(t *testing.T) {
	onDisk, err := filepath.Glob("migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	var want []string
	for _, p := range onDisk {
		if n := filepath.Base(p); n != Bookkeeping {
			want = append(want, n)
		}
	}
	got := Migrations()
	if !slices.Equal(got, want) {
		t.Fatalf("Migrations() = %v, want %v", got, want)
	}
	if len(got) == 0 || !slices.IsSorted(got) {
		t.Fatalf("Migrations() must be non-empty and sorted: %v", got)
	}
	if _, err := os.Stat(filepath.Join("migrations", Bookkeeping)); err != nil {
		t.Fatalf("the bookkeeping migration moved: %v", err)
	}
}

func TestUpSQLAndGrantsAreTheFilesOnDisk(t *testing.T) {
	for _, name := range append([]string{Bookkeeping}, Migrations()...) {
		got, err := UpSQL(name)
		if err != nil {
			t.Fatal(err)
		}
		want, err := os.ReadFile(filepath.Join("migrations", name))
		if err != nil || got != string(want) {
			t.Fatalf("UpSQL(%q) differs from the file (%v)", name, err)
		}
	}
	want, err := os.ReadFile("grants.sql")
	if err != nil || Grants() != string(want) {
		t.Fatalf("Grants() differs from grants.sql (%v)", err)
	}
}
