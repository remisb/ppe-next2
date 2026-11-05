package testlock

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestAppName(t *testing.T) {
	name := AppName("a1b2c3d4", "pid 4194, wt: go test -p 1 -count=1 ./... and much more than fits")
	if len(name) != 63 || !strings.HasPrefix(name, "ppe-test-lock a1b2c3d4 pid 4194, wt: ") {
		t.Errorf("name = %q (%d bytes)", name, len(name))
	}
	if a, b := NewToken(), NewToken(); len(a) != 8 || a == b {
		t.Errorf("tokens %q, %q", a, b)
	}
}

// One run at a time: a second waits, saying who holds the lock, and takes it
// once the first lets go, by releasing it or by its connection going.
func TestPostgresOneRunAtATime(t *testing.T) {
	dsn := os.Getenv("API_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	key = Key + 1 // the run these tests are part of may hold Key
	t.Cleanup(func() { key = Key })
	ctx := context.Background()

	first, err := Acquire(ctx, dsn, "aaaa1111", "pid 1, wt: make e2e", time.Second, nil)
	if err != nil {
		t.Fatal(err)
	}
	look, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer look.Close(ctx)
	h, held, err := HolderOf(ctx, look)
	if err != nil || !held || h.Token != "aaaa1111" || h.What != "pid 1, wt: make e2e" || h.Since.IsZero() {
		t.Fatalf("holder = %+v, %v, %v", h, held, err)
	}

	var told []Holder
	if _, err := Acquire(ctx, dsn, "bbbb2222", "pid 2, other: make test-db", 3*time.Second, func(h Holder) { told = append(told, h) }); err == nil ||
		!strings.Contains(err.Error(), "pid 1, wt: make e2e") {
		t.Fatalf("a second run while the first holds it: %v", err)
	}
	if len(told) != 1 || told[0].Token != "aaaa1111" {
		t.Errorf("told = %+v", told)
	}

	// The first run's connection goes (a crash, or Release): the second takes the lock.
	if err := first.Release(ctx); err != nil {
		t.Fatal(err)
	}
	second, err := Acquire(ctx, dsn, "bbbb2222", "pid 2, other: make test-db", 5*time.Second, nil)
	if err != nil {
		t.Fatalf("after the first let go: %v", err)
	}
	defer second.Release(ctx)
	if h, _, _ := HolderOf(ctx, look); h.Token != "bbbb2222" {
		t.Errorf("holder now = %+v", h)
	}
}
