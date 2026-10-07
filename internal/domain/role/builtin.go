package role

import (
	"slices"

	"github.com/google/uuid"
)

// Keys of the built-in roles, which every installation has (migration 0022).
const (
	KeyAdmin    = "admin"
	KeyManager  = "manager"
	KeyEmployee = "employee"
)

// The built-in roles' fixed ids, the same in every database.
var (
	AdminID    = uuid.MustParse("a0e1d000-0000-4000-8000-000000000001")
	ManagerID  = uuid.MustParse("a0e1d000-0000-4000-8000-000000000002")
	EmployeeID = uuid.MustParse("a0e1d000-0000-4000-8000-000000000003")
)

// builtin is a built-in role as migration 0022 creates it. Its name and
// description never change; the apps translate them by key (Administration's
// users dictionaries hold the same English).
type builtin struct {
	id          uuid.UUID
	key, name   string
	description string
}

var builtinRoles = []builtin{
	{AdminID, KeyAdmin, "Administrator", "Manages users, plus everything a manager can do."},
	{ManagerID, KeyManager, "Manager", "Manages Item Catalogue prices and Item Sets, plus everything an employee can do."},
	{EmployeeID, KeyEmployee, "Employee", "Prepares orders and follows them in Orders, manages employees and sizes."},
}

// BuiltinID is the id of the built-in role with key, or uuid.Nil.
func BuiltinID(key string) uuid.UUID {
	for _, b := range builtinRoles {
		if b.key == key {
			return b.id
		}
	}
	return uuid.Nil
}

// builtins are the built-in roles' permissions as installed. Together they
// reproduce the access the three fixed roles had before permissions existed;
// TestSeededRolesKeepPolicy in cmd/api pins that. Manager and Employee may be
// changed since; Administrator never is.
var builtins = map[string][]Permission{
	KeyAdmin: {
		UsersRead, UsersManage, RolesManage, SettingsManage, BackupsRead, AuditRead, AuditExport, SecurityRead, SystemRead,
		EmployeesDelete, CatalogueManage, ItemSetsManage,
		DashboardOverview,
	},
	KeyManager: {
		UsersRead,
		EmployeesDelete, CatalogueManage, ItemSetsManage, OrdersDelete,
		DashboardManager,
	},
	KeyEmployee: {DashboardEmployee},
}

// BuiltinKeys returns the built-in role keys in display order.
func BuiltinKeys() []string { return []string{KeyAdmin, KeyManager, KeyEmployee} }

// BuiltinPermissions returns the permissions the built-in roles named by keys
// are installed with, in catalogue order. Unknown keys grant nothing.
func BuiltinPermissions(keys []string) []Permission {
	var all []string
	for _, k := range keys {
		for _, p := range builtins[k] {
			if !slices.Contains(all, string(p)) {
				all = append(all, string(p))
			}
		}
	}
	return Known(all)
}
