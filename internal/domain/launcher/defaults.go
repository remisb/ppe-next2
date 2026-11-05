package launcher

import "github.com/remisb/ppe-next2/internal/domain/role"

// administration opens a screen of Administration (the web's
// ADMINISTRATION_PERMISSIONS in @ppe/app-shell, the same list).
var administration = []role.Permission{
	role.UsersManage, role.RolesManage, role.SettingsManage, role.MailTemplatesManage, role.BackupsRead,
	role.AuditRead, role.SecurityRead, role.SystemRead, role.UsageRead, role.AppsManage,
}

// Defaults are the tiles every installation starts with: phase 1's list.
// EnsureDefaults inserts the ones missing by slug and never changes one that
// exists, so what Manage apps changed stays.
var Defaults = []App{
	{Slug: "workwear", Kind: KindApp, Group: "workwear", Icon: "shirt", Color: "#1c2060", Href: "/", Tier: TierHere, Stage: StageLive,
		Names: Names{"Workwear & Equipment", "Darbo drabužiai ir įranga", "Спецодежда и снаряжение"}},
	{Slug: "dashboard", Kind: KindShortcut, Parent: "workwear", Group: "workwear", Icon: "dashboard", Color: "#23703f", Href: "/", Tier: TierHere, Stage: StageLive,
		Names: Names{"Dashboard", "Suvestinė", "Сводка"},
		AnyOf: []role.Permission{role.DashboardOverview, role.DashboardManager, role.DashboardEmployee}},
	{Slug: "create-order", Kind: KindShortcut, Parent: "workwear", Group: "workwear", Icon: "order", Color: "#3341a8", Href: "/orders/new", Tier: TierHere, Stage: StageLive,
		Names: Names{"Create Order", "Kurti užsakymą", "Создать заказ"}},
	{Slug: "orders", Kind: KindShortcut, Parent: "workwear", Group: "workwear", Icon: "orders", Color: "#2a5fb4", Href: "/orders", Tier: TierHere, Stage: StageLive,
		Names: Names{"Orders", "Užsakymai", "Заказы"}},
	{Slug: "employees", Kind: KindShortcut, Parent: "workwear", Group: "workwear", Icon: "employees", Color: "#5b4bb3", Href: "/employees", Tier: TierHere, Stage: StageLive,
		Names: Names{"Employees", "Darbuotojai", "Сотрудники"}},
	{Slug: "help", Kind: KindShortcut, Parent: "workwear", Group: "workwear", Icon: "help", Color: "#5b6475", Href: "/help", Tier: TierHere, Stage: StageLive,
		Names: Names{"Help", "Pagalba", "Справка"}},
	{Slug: "sim-cards", Kind: KindShortcut, Parent: "workwear", Group: "assets", Icon: "sim", Color: "#0e7068", Href: "/assets/sim-cards", Tier: TierHere, Stage: StageLive,
		Names: Names{"SIM Cards", "SIM kortelės", "SIM-карты"}, AnyOf: []role.Permission{role.SIMCardsRead}},
	{Slug: "equipment", Kind: KindShortcut, Parent: "workwear", Group: "assets", Icon: "equipment", Color: "#7a4e14", Href: "/assets/equipment", Tier: TierHere, Stage: StageLive,
		Names: Names{"Equipment", "Įranga", "Оборудование"}, AnyOf: []role.Permission{role.EquipmentRead}},
	{Slug: "sim-scan", Kind: KindApp, Group: "assets", Icon: "scan", Color: "#0f5f8a", Href: "/apps/sim-scan/", Tier: TierHere, Stage: StagePilot,
		Names: Names{"Scan SIMs", "Skenuoti SIM", "Сканировать SIM"}, AnyOf: []role.Permission{role.SIMCardsManage, role.SIMCodesRead}},
	// Who plans crews: administrators and managers, by their dashboards.
	{Slug: "crew", Kind: KindApp, Group: "people", Icon: "crew", Color: "#9a4f0a", Href: "https://crew.167.71.68.195.sslip.io/", Tier: TierLinked, Stage: StagePilot,
		Names: Names{"PPE Crew", "PPE Crew", "PPE Crew"}, AnyOf: []role.Permission{role.DashboardOverview, role.DashboardManager}},
	{Slug: "admin", Kind: KindApp, Group: "admin", Icon: "admin", Color: "#3b4256", Href: "/admin/", Tier: TierHere, Stage: StageLive,
		Names: Names{"Administration", "Administravimas", "Администрирование"}, AnyOf: administration},
	// make new-app adds each new published app's tile above this line, in POC (Testers only).
}
