package audit

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestNewMarshalsSides(t *testing.T) {
	ev, err := New(uuid.New(), nil, "x.changed", "x", uuid.New(), time.Now(), nil, map[string]int{"a": 1})
	if err != nil {
		t.Fatal(err)
	}
	if ev.Before != nil || string(ev.After) != `{"a":1}` {
		t.Errorf("before=%s after=%s", ev.Before, ev.After)
	}
	if _, err := New(uuid.New(), nil, "x", "x", uuid.New(), time.Now(), make(chan int), nil); err == nil {
		t.Error("unmarshalable before should fail")
	}
}

// TestAppendOnly checks the database refuses UPDATE and DELETE on audit rows.
func TestAppendOnly(t *testing.T) {
	dsn := os.Getenv("API_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	ev, _ := New(uuid.New(), nil, "test.event", "test", uuid.New(), time.Now().UTC(), nil, map[string]string{"k": "v"})
	if err := Insert(ctx, pool, ev); err != nil {
		t.Fatalf("insert: %v", err)
	}
	var after string
	var before *string
	if err := pool.QueryRow(ctx, `SELECT after::text, before::text FROM audit_events WHERE id = $1`, ev.ID).Scan(&after, &before); err != nil {
		t.Fatal(err)
	}
	if after != `{"k": "v"}` || before != nil {
		t.Errorf("stored after=%s before=%v", after, before)
	}
	if _, err := pool.Exec(ctx, `UPDATE audit_events SET event = 'tampered' WHERE id = $1`, ev.ID); err == nil {
		t.Error("UPDATE succeeded, want append-only error")
	}
	if _, err := pool.Exec(ctx, `DELETE FROM audit_events WHERE id = $1`, ev.ID); err == nil {
		t.Error("DELETE succeeded, want append-only error")
	}
}
