package scan

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/db/dbtest"
	"github.com/remisb/ppe-next2/internal/files"
)

// pgSetup empties the test database, adds two users, and returns the service
// on the real repository, connected as ppe_app, with a folder for the store.
func pgSetup(t *testing.T) (*Service, *pgxpool.Pool, *clock, uuid.UUID, uuid.UUID) {
	t.Helper()
	dsn := os.Getenv("API_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	owner, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	if _, err := owner.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users CASCADE`); err != nil {
		t.Fatal(err)
	}
	me, other := uuid.New(), uuid.New()
	for i, id := range []uuid.UUID{me, other} {
		if _, err := owner.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, created_at, updated_at,
			created_by_user_id, updated_by_user_id) VALUES ($1, $2, 'Actor', 'x', now(), now(), $1, $1)`,
			id, []string{"me@example.com", "other@example.com"}[i]); err != nil {
			t.Fatal(err)
		}
	}
	app := dbtest.AppPool(t, owner, dsn)
	store, err := files.NewDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	c := &clock{t: time.Now().UTC().Truncate(time.Microsecond)}
	return NewService(NewPostgresRepository(app), testKeys(t), store, WithClock(c.now)), owner, c, me, other
}

func pgCount(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestPostgresKeepListOpenRemovePurge(t *testing.T) {
	svc, owner, c, me, other := pgSetup(t)
	ctx := context.Background()
	start := c.t
	pages := [][]byte{jpegOf(t, 40, 30), jpegOf(t, 30, 40)}

	first, err := svc.Keep(ctx, jonas, pages, me)
	if err != nil {
		t.Fatal(err)
	}
	c.t = start.Add(time.Hour)
	second, err := svc.Keep(ctx, Meta{Surname: "Bandomoji", GivenNames: "Ona", Kind: IDCard}, pages[:1], me)
	if err != nil {
		t.Fatal(err)
	}
	if n := pgCount(t, owner, `SELECT count(*) FROM audit_events WHERE event = $1 AND entity_type = $2`, EventKept, EntityType); n != 2 {
		t.Errorf("kept events = %d, want 2", n)
	}

	list, err := svc.List(ctx, me)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != second.ID || list[1].ID != first.ID || list[1] != first {
		t.Fatalf("List = %+v; want the second, then the first", list)
	}
	if theirs, err := svc.List(ctx, other); err != nil || len(theirs) != 0 {
		t.Errorf("another user's List = %+v, %v", theirs, err)
	}

	if _, err := svc.Open(ctx, first.ID, other); !errors.Is(err, ErrNotFound) {
		t.Errorf("another user's Open: %v", err)
	}
	a, err := svc.Open(ctx, first.ID, me)
	if err != nil {
		t.Fatal(err)
	}
	checkZip(t, a.Zip, pages)
	if a.FileName != "Pavyzdys_Jonas_passport.zip" {
		t.Errorf("file name %q", a.FileName)
	}
	if n := pgCount(t, owner, `SELECT count(*) FROM audit_events WHERE event = $1 AND entity_id = $2`, EventDownloaded, first.ID); n != 1 {
		t.Errorf("download events = %d, want 1", n)
	}

	if err := svc.Remove(ctx, second.ID, other); !errors.Is(err, ErrNotFound) {
		t.Errorf("another user's Remove: %v", err)
	}
	if err := svc.Remove(ctx, second.ID, me); err != nil {
		t.Fatal(err)
	}
	if n := pgCount(t, owner, `SELECT count(*) FROM personnel.scans WHERE id = $1`, second.ID); n != 0 {
		t.Error("Remove left the row")
	}

	// Three days on, the first has expired: hidden, then purged.
	c.t = start.AddDate(0, 0, 3)
	if list, _ := svc.List(ctx, me); len(list) != 0 {
		t.Errorf("List after expiry = %+v", list)
	}
	if _, err := svc.Open(ctx, first.ID, me); !errors.Is(err, ErrNotFound) {
		t.Errorf("Open after expiry: %v", err)
	}
	n, err := svc.PurgeExpired(ctx, slog.New(slog.DiscardHandler))
	if err != nil || n != 1 {
		t.Fatalf("PurgeExpired = %d, %v", n, err)
	}
	if n := pgCount(t, owner, `SELECT count(*) FROM personnel.scans`); n != 0 {
		t.Errorf("rows after the purge = %d", n)
	}
}

func TestPostgresScansAreNeverUpdated(t *testing.T) {
	svc, owner, _, me, _ := pgSetup(t)
	ctx := context.Background()
	kept, err := svc.Keep(ctx, jonas, [][]byte{jpegOf(t, 10, 10)}, me)
	if err != nil {
		t.Fatal(err)
	}
	app := dbtest.AppPool(t, owner, os.Getenv("API_TEST_DB_DSN"))
	if _, err := app.Exec(ctx, `UPDATE personnel.scans SET pages = 2 WHERE id = $1`, kept.ID); err == nil {
		t.Error("ppe_app updated a kept scan")
	}
}

func TestPostgresKeepByAGoneUser(t *testing.T) {
	svc, _, _, _, _ := pgSetup(t)
	if _, err := svc.Keep(context.Background(), jonas, [][]byte{jpegOf(t, 10, 10)}, uuid.New()); !errors.Is(err, ErrActorNotFound) {
		t.Errorf("Keep by no user: %v, want ErrActorNotFound", err)
	}
}
