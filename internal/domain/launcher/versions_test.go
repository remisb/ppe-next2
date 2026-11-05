package launcher

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/role"
)

func scanSIMs(version, channel string) PublishParams {
	return PublishParams{Slug: "sim-scan", Version: version, Commit: "abc", Channel: channel,
		Manifest: Manifest{Slug: "sim-scan", Capabilities: []string{"wasm", "workers", "camera"}}}
}

func names(cs []Channel) []string {
	out := []string{}
	for _, c := range cs {
		out = append(out, c.Name+"="+c.Version)
	}
	return out
}

func TestProfileOf(t *testing.T) {
	if p, err := ProfileOf(nil); err != nil || p != ProfileStandard {
		t.Errorf("none = %v, %v", p, err)
	}
	if p, err := ProfileOf([]string{"camera"}); err != nil || p != ProfileDevice {
		t.Errorf("camera = %v, %v", p, err)
	}
	if _, err := ProfileOf([]string{"eval"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("unknown = %v", err)
	}
}

// A manifest names its profile; an older build's capabilities still say it,
// and both together must agree. Anything else in it (such as the screens
// builds listed while there were variants) is ignored.
func TestManifest(t *testing.T) {
	for _, c := range []struct {
		m    Manifest
		want Profile
	}{
		{Manifest{Profile: ProfileDevice}, ProfileDevice},
		{Manifest{Profile: ProfileStandard}, ProfileStandard},
		{Manifest{Capabilities: []string{"wasm"}}, ProfileDevice},
		{Manifest{}, ProfileStandard},
		{Manifest{Profile: ProfileDevice, Capabilities: []string{"camera"}}, ProfileDevice},
	} {
		if p, err := c.m.ProfileOf(); err != nil || p != c.want {
			t.Errorf("%+v = %v, %v", c.m, p, err)
		}
	}
	for _, m := range []Manifest{{Profile: "gpu"}, {Profile: ProfileStandard, Capabilities: []string{"wasm"}}, {Profile: ProfileDevice, Capabilities: []string{"usb"}}} {
		if _, err := m.ProfileOf(); !errors.Is(err, ErrInvalid) {
			t.Errorf("%+v = %v", m, err)
		}
	}
}

func TestPublishAndChannels(t *testing.T) {
	repo := newMem()
	svc := NewService(repo)
	ctx, admin := context.Background(), uuid.New()

	// The first publish, to Preview, gives the app its Stable too; publishing again is a no-op.
	v1, err := svc.Publish(ctx, scanSIMs("2026.11.04-aaa", ChannelPreview), nil)
	if err != nil || v1.Profile != ProfileDevice {
		t.Fatalf("Publish = %+v, %v", v1, err)
	}
	if _, err := svc.Publish(ctx, scanSIMs("2026.11.04-aaa", ChannelPreview), nil); err != nil {
		t.Fatalf("publishing again: %v", err)
	}
	_, chans, _ := svc.Releases(ctx, "sim-scan")
	if got := names(chans); !slices.Equal(got, []string{"stable=2026.11.04-aaa", "preview=2026.11.04-aaa"}) {
		t.Errorf("channels %v", got)
	}
	// The next deploy moves Preview only.
	if _, err := svc.Publish(ctx, scanSIMs("2026.11.05-bbb", ChannelPreview), nil); err != nil {
		t.Fatal(err)
	}
	vs, chans, _ := svc.Releases(ctx, "sim-scan")
	if len(vs) != 2 || vs[0].Version != "2026.11.05-bbb" || !slices.Equal(names(chans), []string{"stable=2026.11.04-aaa", "preview=2026.11.05-bbb"}) {
		t.Errorf("after the second deploy: %v, %v", len(vs), names(chans))
	}

	// Refusals: another app's manifest, a bad version, a shortcut, a linked site, a channel that is not Stable, Beta or Preview.
	bad := scanSIMs("2026.11.05-ccc", "")
	bad.Manifest.Slug = "admin"
	if _, err := svc.Publish(ctx, bad, nil); !errors.Is(err, ErrInvalid) {
		t.Errorf("another app's build: %v", err)
	}
	if _, err := svc.Publish(ctx, scanSIMs("yesterday", ""), nil); !errors.Is(err, ErrInvalid) {
		t.Errorf("bad version: %v", err)
	}
	crew := PublishParams{Slug: "crew", Version: "2026.11.05-ccc", Manifest: Manifest{Slug: "crew"}}
	if _, err := svc.Publish(ctx, crew, nil); !errors.Is(err, ErrInvalid) {
		t.Errorf("a linked site: %v", err)
	}
	if _, err := svc.Publish(ctx, scanSIMs("2026.11.05-ccc", "photos-first"), nil); !errors.Is(err, ErrInvalid) {
		t.Errorf("a named channel (variants were removed): %v", err)
	}
	if _, found, err := svc.Version(ctx, "sim-scan", "2026.11.05-ccc"); found || err != nil {
		t.Errorf("a publish refused for its channel recorded the version: %v, %v", found, err)
	}

	// Manage apps: promote to Stable and Beta, roll Stable back; one event per move, none for no move.
	n := len(repo.events)
	if _, err := svc.PointChannel(ctx, "sim-scan", ChannelStable, ChannelParams{Version: "2026.11.05-bbb"}, admin); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PointChannel(ctx, "sim-scan", ChannelStable, ChannelParams{Version: "2026.11.05-bbb"}, admin); err != nil || len(repo.events) != n+1 {
		t.Errorf("moving to where it is: %v, %d events", err, len(repo.events)-n)
	}
	if _, err := svc.PointChannel(ctx, "sim-scan", ChannelBeta, ChannelParams{Version: "2026.11.04-aaa"}, admin); err != nil {
		t.Fatal(err)
	}
	if last := repo.events[len(repo.events)-1]; last.Event != EventChannelMoved || last.Before != nil || !strings.Contains(string(last.After), `"beta"`) {
		t.Errorf("Beta's first move = %s %s → %s", last.Event, last.Before, last.After)
	}
	if _, err := svc.PointChannel(ctx, "sim-scan", ChannelStable, ChannelParams{Version: "2026.11.04-aaa"}, admin); err != nil || len(repo.events) != n+3 {
		t.Errorf("rolling Stable back: %v, %d events", err, len(repo.events)-n)
	}
	if _, err := svc.PointChannel(ctx, "sim-scan", "photos-first", ChannelParams{Version: "2026.11.04-aaa"}, admin); !errors.Is(err, ErrInvalid) {
		t.Errorf("a named channel (variants were removed): %v", err)
	}
	if _, err := svc.PointChannel(ctx, "sim-scan", ChannelStable, ChannelParams{Version: "2026.01.01-zzz"}, admin); !errors.Is(err, ErrInvalid) {
		t.Errorf("an unpublished version: %v", err)
	}
}

func TestChannelsForUsersAndResolve(t *testing.T) {
	repo := newMem()
	svc := NewService(repo)
	ctx, user := context.Background(), uuid.New()
	_, _ = svc.Publish(ctx, scanSIMs("2026.11.04-aaa", ""), nil)
	_, _ = svc.Publish(ctx, scanSIMs("2026.11.05-bbb", ChannelBeta), nil)
	manager := holding(role.AssetsManage, role.DashboardManager)
	tester := holding(role.AssetsManage, role.DashboardManager, role.AppsPreview)

	apps, _, _ := svc.ForUser(ctx, user, manager)
	seen, _, _ := svc.ChannelsFor(ctx, user, apps, manager)
	if got := names(seen["sim-scan"]); !slices.Equal(got, []string{"stable=2026.11.04-aaa"}) {
		t.Errorf("a manager sees %v", got)
	}
	if err := svc.ChooseChannel(ctx, user, "sim-scan", ChannelBeta, manager); !errors.Is(err, ErrInvalid) {
		t.Errorf("a manager choosing Beta: %v", err)
	}
	apps, _, _ = svc.ForUser(ctx, user, tester)
	if err := svc.ChooseChannel(ctx, user, "sim-scan", ChannelBeta, tester); err != nil {
		t.Fatal(err)
	}
	seen, chosen, _ := svc.ChannelsFor(ctx, user, apps, tester)
	if len(seen["sim-scan"]) != 2 || chosen["sim-scan"] != ChannelBeta {
		t.Errorf("a tester: %v, chose %v", names(seen["sim-scan"]), chosen)
	}
	// A choice the user no longer sees is not given.
	if _, chosen, _ = svc.ChannelsFor(ctx, user, apps, manager); chosen["sim-scan"] != "" {
		t.Errorf("a lapsed choice: %v", chosen)
	}
	if err := svc.ChooseChannel(ctx, user, "sim-scan", ChannelStable, tester); err != nil || len(repo.choices) != 0 {
		t.Errorf("back to Stable: %v, %v", err, repo.choices)
	}

	for _, c := range []struct{ segment, channel, version, mount string }{
		{"", ChannelStable, "2026.11.04-aaa", "/apps/sim-scan/"},
		{"find", ChannelStable, "2026.11.04-aaa", "/apps/sim-scan/"},
		{"stable", ChannelStable, "2026.11.04-aaa", "/apps/sim-scan/stable/"},
		{"beta", ChannelBeta, "2026.11.05-bbb", "/apps/sim-scan/beta/"},
		{"@2026.11.05-bbb", "@2026.11.05-bbb", "2026.11.05-bbb", "/apps/sim-scan/@2026.11.05-bbb/"},
	} {
		r, err := svc.Resolve(ctx, "sim-scan", c.segment)
		if err != nil || r.Channel != c.channel || r.Version.Version != c.version || r.Mount != c.mount {
			t.Errorf("Resolve(%q) = %s %s %s, %v", c.segment, r.Channel, r.Version.Version, r.Mount, err)
		}
	}
	if _, err := svc.Resolve(ctx, "sim-scan", "@2020.01.01-x"); !errors.Is(err, ErrNotFound) {
		t.Errorf("an unknown version: %v", err)
	}
	if _, err := svc.Resolve(ctx, "admin", ""); !errors.Is(err, ErrNotPublished) {
		t.Errorf("an app on its own address: %v", err)
	}
	if _, err := svc.Resolve(ctx, "orders", ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("a shortcut: %v", err)
	}
	if _, err := svc.Resolve(ctx, "nope", ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("an unknown app: %v", err)
	}
}

func TestReservedSlugs(t *testing.T) {
	for _, slug := range []string{"assets", "files"} {
		p := valid()
		p.Slug = slug
		if err := p.Validate(); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", slug, err)
		}
	}
}

func TestStableFollowsDeploys(t *testing.T) {
	repo := newMem()
	svc := NewService(repo)
	ctx, admin := context.Background(), uuid.New()
	if _, err := svc.Publish(ctx, scanSIMs("2026.11.04-aaa", ChannelPreview), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetStableFollowsDeploys(ctx, "crew", true, admin); err == nil {
		t.Error("a linked site follows deploys")
	}
	a, err := svc.SetStableFollowsDeploys(ctx, "sim-scan", true, admin)
	if err != nil || !a.StableFollowsDeploys {
		t.Fatalf("SetStableFollowsDeploys = %+v, %v", a, err)
	}
	events := len(repo.events)
	if _, err := svc.SetStableFollowsDeploys(ctx, "sim-scan", true, admin); err != nil || len(repo.events) != events {
		t.Errorf("no change recorded %d events, %v", len(repo.events)-events, err)
	}
	// A deploy's Preview moves Stable too; a publish to Beta does not.
	if _, err := svc.Publish(ctx, scanSIMs("2026.11.05-bbb", ChannelPreview), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Publish(ctx, scanSIMs("2026.11.06-ccc", ChannelBeta), nil); err != nil {
		t.Fatal(err)
	}
	_, chans, _ := svc.Releases(ctx, "sim-scan")
	if got := names(chans); !slices.Equal(got, []string{"stable=2026.11.05-bbb", "preview=2026.11.05-bbb", "beta=2026.11.06-ccc"}) {
		t.Errorf("channels %v", got)
	}
}

func TestPrune(t *testing.T) {
	repo := newMem()
	svc := NewService(repo)
	ctx := context.Background()
	for i := 1; i <= 8; i++ {
		if _, err := svc.Publish(ctx, scanSIMs(fmt.Sprintf("2026.11.%02d-v%d", i, i), ChannelPreview), nil); err != nil {
			t.Fatal(err)
		}
	}
	// Stable stays on the first (set by the first publish), Preview on the eighth.
	removed, err := svc.Prune(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, p := range removed {
		got = append(got, p.Slug+" "+p.Version.Version)
	}
	if !slices.Equal(got, []string{"sim-scan 2026.11.03-v3", "sim-scan 2026.11.02-v2"}) {
		t.Errorf("pruned %v", got)
	}
	vs, _, _ := svc.Releases(ctx, "sim-scan")
	if len(vs) != KeepVersions+1 || vs[len(vs)-1].Version != "2026.11.01-v1" {
		t.Errorf("kept %d, oldest %s", len(vs), vs[len(vs)-1].Version)
	}
	if last := repo.events[len(repo.events)-1]; last.Event != EventVersionsPruned || last.ActorUserID != nil {
		t.Errorf("last event %s by %v", last.Event, last.ActorUserID)
	}
	if again, err := svc.Prune(ctx); err != nil || len(again) != 0 {
		t.Errorf("pruning again = %v, %v", again, err)
	}
}
