// Package role holds the permission catalogue and the roles that bundle
// permissions. A route requires one permission; a user holds the permissions
// of every role they have.
package role

import "slices"

// Permission is the key of one thing a role may allow, "resource.action".
// Keys name what they grant, never a role. They are stored in role_permissions
// and carried in the access token's perms claim, so a key never changes: a
// retired permission is removed by a migration and a new key added.
type Permission string

const (
	UsersRead         Permission = "users.read"
	UsersManage       Permission = "users.manage"
	RolesManage       Permission = "roles.manage"
	EmployeesDelete   Permission = "employees.delete"
	CatalogueManage   Permission = "catalogue.manage"
	ItemSetsManage    Permission = "item_sets.manage"
	OrdersDelete      Permission = "orders.delete"
	SettingsManage    Permission = "settings.manage"
	BackupsRead       Permission = "backups.read"
	AuditRead         Permission = "audit.read"
	SecurityRead      Permission = "security.read"
	DashboardOverview Permission = "dashboard.overview"
	DashboardManager  Permission = "dashboard.manager"
	DashboardEmployee Permission = "dashboard.employee"
)

// Group is the heading a permission is listed under on Roles & permissions.
type Group string

const (
	GroupAdministration Group = "administration"
	GroupWorkwear       Group = "workwear"
	GroupDashboards     Group = "dashboards"
)

// Info describes a permission: its group and the permissions it cannot work
// without (managing users needs seeing them). Labels are the frontend's.
type Info struct {
	Key      Permission   `json:"key"`
	Group    Group        `json:"group"`
	Requires []Permission `json:"requires"`
}

// catalogue lists every permission in the order Roles & permissions shows them.
var catalogue = []Info{
	{UsersRead, GroupAdministration, nil},
	{UsersManage, GroupAdministration, []Permission{UsersRead}},
	{RolesManage, GroupAdministration, []Permission{UsersRead}},
	{SettingsManage, GroupAdministration, nil},
	{BackupsRead, GroupAdministration, nil},
	{AuditRead, GroupAdministration, nil},
	{SecurityRead, GroupAdministration, nil},
	{EmployeesDelete, GroupWorkwear, nil},
	{CatalogueManage, GroupWorkwear, nil},
	{ItemSetsManage, GroupWorkwear, nil},
	{OrdersDelete, GroupWorkwear, nil},
	{DashboardOverview, GroupDashboards, nil},
	{DashboardManager, GroupDashboards, nil},
	{DashboardEmployee, GroupDashboards, nil},
}

// Catalogue returns every permission in display order.
func Catalogue() []Info {
	out := make([]Info, len(catalogue))
	for i, p := range catalogue {
		out[i] = Info{Key: p.Key, Group: p.Group, Requires: slices.Clone(p.Requires)}
		if out[i].Requires == nil {
			out[i].Requires = []Permission{}
		}
	}
	return out
}

// IsKnown reports whether key is a permission in the catalogue.
func IsKnown(key string) bool {
	return slices.ContainsFunc(catalogue, func(p Info) bool { return string(p.Key) == key })
}

// Known keeps the keys that are in the catalogue, in catalogue order and
// without duplicates, so equal sets compare and store identically.
func Known(keys []string) []Permission {
	out := make([]Permission, 0, len(keys))
	for _, p := range catalogue {
		if slices.Contains(keys, string(p.Key)) {
			out = append(out, p.Key)
		}
	}
	return out
}

// Strings returns perms as strings, for the token and the database.
func Strings(perms []Permission) []string {
	out := make([]string, len(perms))
	for i, p := range perms {
		out[i] = string(p)
	}
	return out
}
