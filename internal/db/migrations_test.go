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
		if n := filepath.Base(p); n != bookkeeping {
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
	if _, err := os.Stat(filepath.Join("migrations", bookkeeping)); err != nil {
		t.Fatalf("the bookkeeping migration moved: %v", err)
	}
}
