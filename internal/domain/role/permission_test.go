package role

import (
	"os"
	"regexp"
	"slices"
	"testing"
)

// The format role_permissions' CHECK enforces.
var keyFormat = regexp.MustCompile(`^[a-z_]+(\.[a-z_]+)+$`)

func TestCatalogue(t *testing.T) {
	seen := map[Permission]bool{}
	for _, p := range Catalogue() {
		if !keyFormat.MatchString(string(p.Key)) {
			t.Errorf("%q is not resource.action", p.Key)
		}
		if seen[p.Key] {
			t.Errorf("%q listed twice", p.Key)
		}
		seen[p.Key] = true
		if p.Group == "" {
			t.Errorf("%q has no group", p.Key)
		}
		for _, r := range p.Requires {
			if !IsKnown(string(r)) || r == p.Key {
				t.Errorf("%q requires %q, which is not another known permission", p.Key, r)
			}
		}
	}
}

func TestBuiltinsGrantKnownPermissionsWithTheirRequirements(t *testing.T) {
	for _, key := range BuiltinKeys() {
		perms := BuiltinPermissions([]string{key})
		if len(perms) == 0 {
			t.Errorf("built-in role %s grants nothing", key)
		}
		for _, p := range Catalogue() {
			if !slices.Contains(perms, p.Key) {
				continue
			}
			for _, r := range p.Requires {
				if !slices.Contains(perms, r) {
					t.Errorf("built-in role %s has %s without %s", key, p.Key, r)
				}
			}
		}
	}
	// The administrator holds everything but the other roles' own dashboards,
	// deleting orders, which is the manager's, and seeing Equipment &
	// Furniture, which only Equipment Assignments grants.
	admin := BuiltinPermissions([]string{KeyAdmin})
	for _, p := range Catalogue() {
		want := p.Key != DashboardManager && p.Key != DashboardEmployee && p.Key != OrdersDelete && p.Key != EquipmentRead
		if slices.Contains(admin, p.Key) != want {
			t.Errorf("admin has %s = %v, want %v", p.Key, !want, want)
		}
	}
}

// Equipment Assignments is the only built-in role that sees Equipment & Furniture.
func TestOnlyEquipmentAssignmentsSeesEquipment(t *testing.T) {
	for _, key := range BuiltinKeys() {
		if got, want := slices.Contains(BuiltinPermissions([]string{key}), EquipmentRead), key == KeyEquipment; got != want {
			t.Errorf("built-in role %s has equipment.read = %v, want %v", key, got, want)
		}
	}
	if !slices.Equal(BuiltinPermissions([]string{KeyEquipment}), []Permission{EquipmentRead}) {
		t.Errorf("Equipment Assignments = %v, want only equipment.read", BuiltinPermissions([]string{KeyEquipment}))
	}
}

func TestKnownAndBuiltinPermissions(t *testing.T) {
	if got := Known([]string{"orders.delete", "nope", "users.read", "orders.delete"}); !slices.Equal(got, []Permission{UsersRead, OrdersDelete}) {
		t.Errorf("Known = %v: want catalogue order, no unknown keys, no duplicates", got)
	}
	got := BuiltinPermissions([]string{KeyEmployee, KeyManager, "superuser"})
	want := Known(Strings(append(BuiltinPermissions([]string{KeyManager}), DashboardEmployee)))
	if !slices.Equal(got, want) {
		t.Errorf("BuiltinPermissions = %v, want %v", got, want)
	}
}

// The web client lists the same permissions in the same order
// (web/packages/api-client/src/permissions.ts), so its types and the admin
// app's labels cannot miss one.
func TestWebClientListsTheCatalogue(t *testing.T) {
	src, err := os.ReadFile("../../../web/packages/api-client/src/permissions.ts")
	if err != nil {
		t.Fatal(err)
	}
	list := regexp.MustCompile(`(?s)PERMISSIONS = \[(.*?)\] as const`).FindSubmatch(src)
	if list == nil {
		t.Fatal("no PERMISSIONS list in permissions.ts")
	}
	var web []string
	for _, m := range regexp.MustCompile(`'([^']+)'`).FindAllSubmatch(list[1], -1) {
		web = append(web, string(m[1]))
	}
	var want []string
	for _, p := range Catalogue() {
		want = append(want, string(p.Key))
	}
	if !slices.Equal(web, want) {
		t.Errorf("permissions.ts lists %v, the catalogue %v", web, want)
	}
}
