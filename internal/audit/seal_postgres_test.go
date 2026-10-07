package audit

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/db/dbtest"
)

// sealPools empties the trail as the owner and returns the owner's pool and
// the API role's (ppe_app), which the service uses, as in production.
func sealPools(t *testing.T) (owner, app *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("API_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	if _, err := owner.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users, audit_events, audit_seals, audit_purges CASCADE`); err != nil {
		t.Fatal(err)
	}
	return owner, dbtest.AppPool(t, owner, dsn)
}

func insertAt(t *testing.T, pool *pgxpool.Pool, at time.Time, event string, after any) uuid.UUID {
	t.Helper()
	ev, err := New(uuid.New(), nil, event, "employee", uuid.New(), at, nil, after)
	if err != nil {
		t.Fatal(err)
	}
	if err := Insert(context.Background(), pool, ev); err != nil {
		t.Fatal(err)
	}
	return ev.ID
}

// Seals hold over what Postgres stores (jsonb's own key order, microseconds),
// and a change made behind the triggers' back is found.
func TestPostgresSealsAndVerify(t *testing.T) {
	owner, app := sealPools(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	day := now.Truncate(Day).Add(-3 * Day)
	id := insertAt(t, app, day.Add(9*time.Hour+123456*time.Microsecond), "employee.created",
		map[string]any{"last_name": "Jonaitė", "first_name": "Ona", "notes_changed": true})
	insertAt(t, app, day.Add(2*Day+time.Hour), "employee.updated", map[string]any{"code": "E-1"})
	svc := NewService(NewPostgresStore(app), WithClock(func() time.Time { return now }))

	n, err := svc.SealDays(ctx)
	if err != nil || n != 3 {
		t.Fatalf("sealed %d, %v", n, err)
	}
	v, err := svc.Verify(ctx)
	if err != nil || !v.OK || v.Days != 3 || v.Rows != 2 {
		t.Fatalf("verify = %+v, %v", v, err)
	}
	if _, err := app.Exec(ctx, `UPDATE audit_seals SET rows = 0`); err == nil {
		t.Error("ppe_app changed a seal")
	}
	if _, err := owner.Exec(ctx, `DELETE FROM audit_seals`); err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Errorf("the owner deleted a seal: %v", err)
	}

	// Only someone who can switch the triggers off can change a sealed event,
	// and Verify sees it.
	for _, sql := range []string{
		`ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update_delete`,
		`UPDATE audit_events SET after = '{"first_name": "Ana"}' WHERE id = '` + id.String() + `'`,
		`ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update_delete`,
	} {
		if _, err := owner.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	v, err = svc.Verify(ctx)
	if err != nil || v.OK || v.Mismatch == nil || v.Mismatch.Problem != "hash" || !v.Mismatch.Day.Equal(day) {
		t.Errorf("tampered verify = %+v, %v", v.Mismatch, err)
	}
}

// The purge deletes sealed events older than the retention through the
// owner's function, records itself, and leaves the seals verifiable.
func TestPostgresPurge(t *testing.T) {
	_, app := sealPools(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	old := now.Truncate(Day).Add(-400 * Day)
	insertAt(t, app, old.Add(time.Hour), "employee.created", map[string]any{"first_name": "Ona"})
	insertAt(t, app, now.Add(-2*Day), "employee.updated", map[string]any{"code": "E-2"})
	svc := NewService(NewPostgresStore(app), WithClock(func() time.Time { return now }), WithRetention(366*Day))
	if _, err := svc.SealDays(ctx); err != nil {
		t.Fatal(err)
	}
	n, err := svc.PurgeExpired(ctx)
	if err != nil || n != 1 {
		t.Fatalf("purged %d, %v", n, err)
	}
	purges, _ := svc.Purges(ctx)
	if len(purges) != 1 || purges[0].Rows != 1 {
		t.Errorf("purges = %+v", purges)
	}
	page, err := svc.List(ctx, Filter{Event: EventPurged})
	if err != nil || len(page.Events) != 1 || page.Events[0].Area != AreaAudit {
		t.Errorf("purge event = %+v, %v", page.Events, err)
	}
	if v, err := svc.Verify(ctx); err != nil || !v.OK || v.PurgedDays == 0 {
		t.Errorf("verify after the purge = %+v, %v", v, err)
	}
}

// Stamps are stored as the API role writes them, once per day, and are
// append-only, as the seals they anchor are.
func TestPostgresStamps(t *testing.T) {
	owner, app := sealPools(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	day := now.Truncate(Day).Add(-2 * Day)
	insertAt(t, app, day.Add(9*time.Hour), "employee.created", map[string]any{"code": "E-1"})
	c := now
	tsa := &fakeTSA{now: func() time.Time { return c.Truncate(time.Second) }}
	svc := NewService(NewPostgresStore(app), WithClock(func() time.Time { return now }), WithTimestamps(tsa), WithStampsFrom(day))

	if _, err := svc.SealDays(ctx); err != nil {
		t.Fatal(err)
	}
	if n, err := svc.StampDays(ctx); err != nil || n != 2 {
		t.Fatalf("stamped %d, %v", n, err)
	}
	stamps, err := svc.Stamps(ctx)
	if err != nil || len(stamps) != 2 || !stamps[0].Day.Equal(day) || stamps[0].TSA != "http://tsa.test" || len(stamps[0].Token) == 0 {
		t.Fatalf("stamps = %+v, %v", stamps, err)
	}
	if err := NewPostgresStore(app).AddStamp(ctx, stamps[0]); err != ErrStamped {
		t.Errorf("a second stamp of a day: %v, want ErrStamped", err)
	}
	if v, err := svc.Verify(ctx); err != nil || !v.OK || v.Stamped != 2 {
		t.Fatalf("verify = %+v, %v", v, err)
	}
	for _, sql := range []string{`UPDATE audit_seal_stamps SET tsa = 'x'`, `DELETE FROM audit_seal_stamps`, `TRUNCATE audit_seal_stamps`} {
		if _, err := owner.Exec(ctx, sql); err == nil || !strings.Contains(err.Error(), "append-only") && !strings.Contains(err.Error(), "may not be truncated") {
			t.Errorf("%s as the owner: %v, want refused", sql, err)
		}
	}
}
