package main

import (
	"os"
	"regexp"
	"slices"
	"testing"

	"github.com/remisb/ppe-next2/internal/domain/launcher"
	"github.com/remisb/ppe-next2/internal/domain/role"
)

// TestLauncherTilesAreValid: every default tile passes the registry's rules
// with this site's configuration.
func TestLauncherTilesAreValid(t *testing.T) {
	for _, d := range launcherTiles {
		f := launcher.Fields{Parent: d.Parent, Group: d.Group, Icon: d.Icon, Color: d.Color, Href: d.Href, Tier: d.Tier, Stage: d.Stage, Names: d.Names, AnyOf: d.AnyOf}
		if err := (launcher.CreateParams{Slug: d.Slug, Kind: d.Kind, Fields: f}).Validate(launcherConfig); err != nil {
			t.Errorf("default %s: %v", d.Slug, err)
		}
	}
	// Administration's tile follows every permission that opens one of its screens.
	for _, p := range []role.Permission{role.UsersManage, role.AuditRead, role.AppsManage} {
		if !slices.Contains(administration, p) {
			t.Errorf("Administration's tile misses %s", p)
		}
	}
	if !slices.Equal(launcherConfig.Known(launcherConfig.Permissions), launcherConfig.Permissions) {
		t.Error("the permission catalogue repeats a key")
	}
}

// TestWebClientListsTheIcons: the web draws each picture the API accepts.
func TestWebClientListsTheIcons(t *testing.T) {
	src, err := os.ReadFile("../../web/packages/api-client/src/app-icons.ts")
	if err != nil {
		t.Fatal(err)
	}
	list := regexp.MustCompile(`(?s)APP_ICONS = \[(.*?)\] as const`).FindSubmatch(src)
	if list == nil {
		t.Fatal("no APP_ICONS list in app-icons.ts")
	}
	var web []string
	for _, m := range regexp.MustCompile(`'([^']+)'`).FindAllSubmatch(list[1], -1) {
		web = append(web, string(m[1]))
	}
	if !slices.Equal(web, launcherConfig.Icons) {
		t.Errorf("app-icons.ts lists %v, the API %v", web, launcherConfig.Icons)
	}
}
