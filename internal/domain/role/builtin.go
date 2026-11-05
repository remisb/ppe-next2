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
	// KeyEquipment is Equipment Assignments (migration 0032): the only
	// built-in role that sees Equipment & Furniture and who holds each item.
	KeyEquipment = "equipment"
	// KeyTesters is Testers (migration 0042): sees App Launcher's apps in
	// testing (POC, In development).
	KeyTesters = "testers"
	// KeyPersonnel is Personnel Documents (migration 0048, ADR 0007): the only
	// built-in role that sees, scans and saves identity documents.
	KeyPersonnel = "personnel"
)

// The built-in roles' fixed ids, the same in every database.
var (
	AdminID     = uuid.MustParse("a0e1d000-0000-4000-8000-000000000001")
	ManagerID   = uuid.MustParse("a0e1d000-0000-4000-8000-000000000002")
	EmployeeID  = uuid.MustParse("a0e1d000-0000-4000-8000-000000000003")
	EquipmentID = uuid.MustParse("a0e1d000-0000-4000-8000-000000000004")
	TestersID   = uuid.MustParse("a0e1d000-0000-4000-8000-000000000005")
	PersonnelID = uuid.MustParse("a0e1d000-0000-4000-8000-000000000006")
)

// builtin is a built-in role as migration 0022 (Equipment Assignments, 0032; Testers, 0042;
// Personnel Documents, 0048) creates it. Its name and
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
	{EquipmentID, KeyEquipment, "Equipment Assignments", "Sees Equipment & Furniture: each item and who holds it."},
	{TestersID, KeyTesters, "Testers", "Sees App Launcher's apps in testing."},
	{PersonnelID, KeyPersonnel, "Personnel Documents", "Scans, saves and shows identity documents."},
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

// builtins are the built-in roles' permissions as installed. Together the
// first three reproduce the access the three fixed roles had before
// permissions existed, with Equipment & Furniture since taken from them, and
// hold what was split off later (item_sets.read, item_prices.manage: 0038)
// or added since (sim_codes.read, Administrator's: 0041; apps.manage, Administrator's: 0042;
// sim_cards.read and sim_cards.manage, split off in 0049 like 0038's);
// TestSeededRolesKeepPolicy in cmd/api pins that. Manager and Employee may be
// changed since; Administrator never is.
var builtins = map[string][]Permission{
	KeyAdmin: {
		UsersRead, UsersManage, RolesManage, SettingsManage, MailTemplatesManage, BackupsRead, AuditRead, AuditExport, SecurityRead, SystemRead, UsageRead,
		AppsManage,
		EmployeesDelete, CatalogueManage, ItemPricesManage, ItemSetsRead, ItemSetsManage, AssetsManage, SIMCardsRead, SIMCardsManage, SIMCodesRead,
		DashboardOverview,
	},
	KeyManager: {
		UsersRead,
		EmployeesDelete, CatalogueManage, ItemPricesManage, ItemSetsRead, ItemSetsManage, OrdersDelete, AssetsManage, SIMCardsRead, SIMCardsManage,
		DashboardManager,
	},
	KeyEmployee: {ItemSetsRead, SIMCardsRead, DashboardEmployee},
	// Not even Administrator sees Equipment & Furniture without this role.
	KeyEquipment: {EquipmentRead},
	// Apps in testing are for the people trying them, administrators included only when they hold it.
	KeyTesters: {AppsPreview},
	// Identity documents are for the people who handle them, administrators included only when
	// they hold it; AI colouring is given separately (personnel.portraits.colorize).
	KeyPersonnel: {PersonnelDocumentsRead, PersonnelDocumentsManage},
}

// BuiltinKeys returns the built-in role keys in display order.
func BuiltinKeys() []string {
	return []string{KeyAdmin, KeyManager, KeyEmployee, KeyEquipment, KeyTesters, KeyPersonnel}
}

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
