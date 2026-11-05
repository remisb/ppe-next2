package launcher

import (
	"context"
	"errors"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/domain/role"
)

// newTestPool empties the database (which empties the registry, through its
// actor key), inserts an actor and the default tiles.
func newTestPool(t *testing.T) (*pgxpool.Pool, uuid.UUID) {
	t.Helper()
	dsn := os.Getenv("API_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users, audit_events, audit_seals, audit_purges CASCADE`); err != nil {
		t.Fatal(err)
	}
	actor := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, created_at, updated_at,
		created_by_user_id, updated_by_user_id) VALUES ($1, 'a@example.com', 'Ana', 'x', now(), now(), $1, $1)`, actor); err != nil {
		t.Fatal(err)
	}
	if err := EnsureDefaults(ctx, pool); err != nil {
		t.Fatal(err)
	}
	return pool, actor
}

func TestPostgresRegistry(t *testing.T) {
	pool, actor := newTestPool(t)
	ctx := context.Background()
	svc := NewService(NewPostgresRepository(pool))

	list, err := svc.List(ctx)
	if err != nil || len(list) != len(Defaults) || list[0].Slug != "workwear" || list[0].UpdatedByUserID != nil {
		t.Fatalf("defaults: %v, %v", slugs(list), err)
	}
	admin, _ := svc.Get(ctx, "admin")
	if !slices.Contains(admin.AnyOf, role.AppsManage) {
		t.Errorf("Administration's audience %v", admin.AnyOf)
	}

	// A change made on Manage apps survives EnsureDefaults; a missing default comes back last.
	up := UpdateParams{Fields{Group: "people", Icon: "crew", Color: "#9a4f0a", Href: "https://crew.example.org/", Tier: TierLinked,
		Stage: StageLive, Names: Names{"PPE Crew", "PPE Crew", "PPE Crew"}}}
	if _, err := svc.Update(ctx, "crew", up, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM launcher_apps WHERE slug = 'help'`); err != nil {
		t.Fatal(err)
	}
	if err := EnsureDefaults(ctx, pool); err != nil {
		t.Fatal(err)
	}
	crew, _ := svc.Get(ctx, "crew")
	list, _ = svc.List(ctx)
	if crew.Href != "https://crew.example.org/" || crew.Stage != StageLive || crew.AnyOf == nil || len(crew.AnyOf) != 0 || list[len(list)-1].Slug != "help" {
		t.Errorf("after EnsureDefaults: crew %+v, last %s", crew, list[len(list)-1].Slug)
	}

	// A default no administrator touched follows the code (as an older release left it, here by hand),
	// recorded by no one; crew, edited above, stays as the administrator left it.
	if _, err := pool.Exec(ctx, `UPDATE launcher_apps SET name_en = 'Old name', any_of = '{users.manage}' WHERE slug = 'orders'`); err != nil {
		t.Fatal(err)
	}
	if err := EnsureDefaults(ctx, pool); err != nil {
		t.Fatal(err)
	}
	orders, _ := svc.Get(ctx, "orders")
	want := Defaults[slices.IndexFunc(Defaults, func(d App) bool { return d.Slug == "orders" })]
	if orders.Names != want.Names || !slices.Equal(orders.AnyOf, want.AnyOf) || orders.UpdatedByUserID != nil {
		t.Errorf("orders after EnsureDefaults: %+v", orders)
	}
	var synced, byNoOne int
	if err := pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE actor_user_id IS NULL) FROM audit_events
		WHERE entity_id = $1 AND event IN ('app.changed', 'app.audience_changed')`, orders.ID).Scan(&synced, &byNoOne); err != nil || synced != 2 || byNoOne != 2 {
		t.Errorf("events for the synced default = %d (%d by no one), %v", synced, byNoOne, err)
	}
	if crew, _ := svc.Get(ctx, "crew"); crew.Href != "https://crew.example.org/" {
		t.Errorf("an administrator's change was overwritten: %s", crew.Href)
	}

	a, err := svc.Create(ctx, valid(), actor)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctx, valid(), actor); !errors.Is(err, ErrSlugTaken) {
		t.Errorf("same slug: %v", err)
	}
	var events int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_type = 'app' AND entity_id = $1`, a.ID).Scan(&events); err != nil || events != 1 {
		t.Errorf("events on the new tile = %d, %v", events, err)
	}
	moved, err := svc.Move(ctx, "size-helper", "workwear", actor)
	if err != nil || moved[0].Slug != "size-helper" || moved[0].Position != positionStep {
		t.Fatalf("Move = %v, %v", slugs(moved), err)
	}

	// Pins: replaced, in order; a user's go with them.
	tester := func(p role.Permission) bool { return p == role.AppsPreview || p == role.AssetsManage }
	if _, err := svc.SetPins(ctx, actor, []string{"size-helper", "workwear"}, tester); err != nil {
		t.Fatal(err)
	}
	if _, pins, err := svc.ForUser(ctx, actor, tester); err != nil || !slices.Equal(pins, []string{"size-helper", "workwear"}) {
		t.Errorf("pins %v, %v", pins, err)
	}
	if _, err := svc.SetPins(ctx, actor, []string{"workwear"}, tester); err != nil {
		t.Fatal(err)
	}
	if _, pins, _ := svc.ForUser(ctx, actor, tester); !slices.Equal(pins, []string{"workwear"}) {
		t.Errorf("pins after replacing %v", pins)
	}
	// Replaces at once (two tabs, an effect run twice) take turns; none fails.
	const together = 8
	errs := make(chan error, together)
	start := make(chan struct{})
	for range together {
		go func() {
			<-start
			_, err := svc.SetPins(ctx, actor, []string{"size-helper", "workwear"}, tester)
			errs <- err
		}()
	}
	close(start)
	for range together {
		if err := <-errs; err != nil {
			t.Errorf("a replace beside another: %v", err)
		}
	}
	if _, pins, _ := svc.ForUser(ctx, actor, tester); !slices.Equal(pins, []string{"size-helper", "workwear"}) {
		t.Errorf("pins after two replaces at once %v", pins)
	}

	if _, err := svc.GiveFeedback(ctx, actor, FeedbackParams{App: "size-helper", Rating: "broken", Text: "Blank page", Device: "tablet", Language: "en"}, tester); err != nil {
		t.Fatal(err)
	}
	fb, err := svc.Feedback(ctx, "size-helper")
	if err != nil || len(fb) != 1 || fb[0].UserName != "Ana" || fb[0].Rating != "broken" {
		t.Errorf("Feedback = %+v, %v", fb, err)
	}
	if fb, err := svc.Feedback(ctx, "workwear"); err != nil || fb == nil || len(fb) != 0 {
		t.Errorf("no feedback = %v, %v", fb, err)
	}
}

func TestPostgresVersions(t *testing.T) {
	pool, actor := newTestPool(t)
	ctx := context.Background()
	svc := NewService(NewPostgresRepository(pool))

	if _, err := svc.Publish(ctx, scanSIMs("2026.11.04-aaa", ChannelPreview), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Publish(ctx, scanSIMs("2026.11.05-bbb", ChannelPreview), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Publish(ctx, scanSIMs("2026.11.05-bbb", ChannelPreview), nil); err != nil {
		t.Fatalf("publishing again: %v", err)
	}
	versions, channels, err := svc.Releases(ctx, "sim-scan")
	if err != nil || len(versions) != 2 || versions[0].Version != "2026.11.05-bbb" || versions[0].Profile != ProfileDevice ||
		!slices.Equal(names(channels), []string{"stable=2026.11.04-aaa", "preview=2026.11.05-bbb"}) {
		t.Fatalf("Releases = %v, %v, %v", len(versions), names(channels), err)
	}

	if _, err := svc.PointChannel(ctx, "sim-scan", ChannelBeta, ChannelParams{Version: "2026.11.04-aaa"}, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PointChannel(ctx, "sim-scan", ChannelStable, ChannelParams{Version: "2026.11.05-bbb"}, actor); err != nil {
		t.Fatal(err)
	}
	_, channels, _ = svc.Releases(ctx, "sim-scan")
	if !slices.Equal(names(channels), []string{"stable=2026.11.05-bbb", "beta=2026.11.04-aaa", "preview=2026.11.05-bbb"}) {
		t.Errorf("channels %v", names(channels))
	}
	var events int
	// Two versions published (not the repeat); Stable and Preview first set, Preview moved, Beta set, Stable promoted.
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE event LIKE 'app.%' AND event <> 'app.registered'`).Scan(&events); err != nil || events != 7 {
		t.Errorf("app events = %d, %v", events, err)
	}
	// Migration 0047: only the three channels may be stored.
	if _, err := pool.Exec(ctx, `UPDATE launcher_channels SET name = 'photos-first' WHERE name = 'beta'`); err == nil {
		t.Error("a channel other than stable, beta or preview was stored")
	}

	tester := func(p role.Permission) bool { return p == role.AppsPreview || p == role.AssetsManage }
	if err := svc.ChooseChannel(ctx, actor, "sim-scan", ChannelBeta, tester); err != nil {
		t.Fatal(err)
	}
	apps, _, _ := svc.ForUser(ctx, actor, tester)
	seen, chosen, err := svc.ChannelsFor(ctx, actor, apps, tester)
	if err != nil || len(seen["sim-scan"]) != 3 || chosen["sim-scan"] != ChannelBeta {
		t.Errorf("ChannelsFor = %v, %v, %v", names(seen["sim-scan"]), chosen, err)
	}
	r, err := svc.Resolve(ctx, "sim-scan", ChannelBeta)
	if err != nil || r.Version.Version != "2026.11.04-aaa" || r.Mount != "/apps/sim-scan/beta/" {
		t.Errorf("Resolve = %+v, %v", r, err)
	}
	// Scan SIMs' tile lives under /apps/ (migration 0043, defaults).
	a, _ := svc.Get(ctx, "sim-scan")
	if a.Href != "/apps/sim-scan/" {
		t.Errorf("Scan SIMs' address %s", a.Href)
	}
}
