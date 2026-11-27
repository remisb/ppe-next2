package main

import (
	"github.com/remisb/ppe-next2/internal/domain/launcher"
	"github.com/remisb/ppe-next2/internal/domain/role"
)

// App Launcher's configuration in this project (ADR 0009): the registry
// (internal/domain/launcher) knows no host's permissions, languages, groups,
// pictures or tiles; launcherConfig and launcherTiles are this site's.

// launcherConfig is this site's: the permission catalogue, Testers'
// apps.preview, English, Lithuanian and Russian, the launcher's four groups
// and the pictures @ppe/launcher draws (app-icons.ts; TestWebClientListsTheIcons).
var launcherConfig = launcher.Config{
	Permissions: permissionKeys(),
	Preview:     string(role.AppsPreview),
	Languages:   []string{"en", "lt", "ru"},
	// Workwear & PPE, Company Assets, People & Crew, Administration.
	Groups: []launcher.Group{"workwear", "assets", "people", "admin"},
	Icons: []string{
		"shirt", "order", "orders", "employees", "dashboard", "sim", "equipment", "scan", "crew", "admin", "help",
		"box", "flask", "pen", "check", "chart", "calendar", "truck", "wrench",
	},
}

// permissionKeys is the permission catalogue's keys, in its order.
func permissionKeys() []string {
	cat := role.Catalogue()
	out := make([]string, len(cat))
	for i, p := range cat {
		out[i] = string(p.Key)
	}
	return out
}

// tileNames is a tile's name in English, Lithuanian and Russian.
func tileNames(en, lt, ru string) launcher.Names { return launcher.Names{"en": en, "lt": lt, "ru": ru} }

// administration opens a screen of Administration (the web's
// ADMINISTRATION_PERMISSIONS in @ppe/app-shell, the same list).
var administration = []role.Permission{
	role.UsersManage, role.RolesManage, role.SettingsManage, role.MailTemplatesManage, role.SuppliersManage, role.CompaniesManage, role.BackupsRead,
	role.AuditRead, role.SecurityRead, role.SystemRead, role.UsageRead, role.AppsManage,
}

// launcherTiles are the tiles every installation starts with: phase 1's list
// and each published app make new-app added. EnsureDefaults inserts the ones
// missing by slug and brings one no administrator has changed in line with
// its entry here; one Manage apps changed stays as it is.
var launcherTiles = []launcher.App{
	{Slug: "workwear", Kind: launcher.KindApp, Group: "workwear", Icon: "shirt", Color: "#1c2060", Href: "/", Tier: launcher.TierHere, Stage: launcher.StageLive,
		Names: tileNames("Workwear & Equipment", "Darbo drabužiai ir įranga", "Спецодежда и снаряжение")},
	{Slug: "dashboard", Kind: launcher.KindShortcut, Parent: "workwear", Group: "workwear", Icon: "dashboard", Color: "#23703f", Href: "/", Tier: launcher.TierHere, Stage: launcher.StageLive,
		Names: tileNames("Dashboard", "Suvestinė", "Сводка"),
		AnyOf: role.Strings([]role.Permission{role.DashboardOverview, role.DashboardManager, role.DashboardEmployee})},
	{Slug: "create-order", Kind: launcher.KindShortcut, Parent: "workwear", Group: "workwear", Icon: "order", Color: "#3341a8", Href: "/orders/new", Tier: launcher.TierHere, Stage: launcher.StageLive,
		Names: tileNames("Create Order", "Kurti užsakymą", "Создать заказ")},
	{Slug: "orders", Kind: launcher.KindShortcut, Parent: "workwear", Group: "workwear", Icon: "orders", Color: "#2a5fb4", Href: "/orders", Tier: launcher.TierHere, Stage: launcher.StageLive,
		Names: tileNames("Orders", "Užsakymai", "Заказы")},
	{Slug: "employees", Kind: launcher.KindShortcut, Parent: "workwear", Group: "workwear", Icon: "employees", Color: "#5b4bb3", Href: "/employees", Tier: launcher.TierHere, Stage: launcher.StageLive,
		Names: tileNames("Employees", "Darbuotojai", "Сотрудники")},
	{Slug: "help", Kind: launcher.KindShortcut, Parent: "workwear", Group: "workwear", Icon: "help", Color: "#5b6475", Href: "/help", Tier: launcher.TierHere, Stage: launcher.StageLive,
		Names: tileNames("Help", "Pagalba", "Справка")},
	{Slug: "sim-cards", Kind: launcher.KindShortcut, Parent: "workwear", Group: "assets", Icon: "sim", Color: "#0e7068", Href: "/assets/sim-cards", Tier: launcher.TierHere, Stage: launcher.StageLive,
		Names: tileNames("SIM Cards", "SIM kortelės", "SIM-карты"), AnyOf: role.Strings([]role.Permission{role.SIMCardsRead})},
	{Slug: "equipment", Kind: launcher.KindShortcut, Parent: "workwear", Group: "assets", Icon: "equipment", Color: "#7a4e14", Href: "/assets/equipment", Tier: launcher.TierHere, Stage: launcher.StageLive,
		Names: tileNames("Equipment", "Įranga", "Оборудование"), AnyOf: role.Strings([]role.Permission{role.EquipmentRead})},
	{Slug: "sim-scan", Kind: launcher.KindApp, Group: "assets", Icon: "scan", Color: "#0f5f8a", Href: "/apps/sim-scan/", Tier: launcher.TierHere, Stage: launcher.StagePilot,
		Names: tileNames("Scan SIMs", "Skenuoti SIM", "Сканировать SIM"), AnyOf: role.Strings([]role.Permission{role.SIMCardsManage})},
	// Who plans crews: administrators and managers, by their dashboards.
	{Slug: "crew", Kind: launcher.KindApp, Group: "people", Icon: "crew", Color: "#9a4f0a", Href: "https://crew.167.71.68.195.sslip.io/", Tier: launcher.TierLinked, Stage: launcher.StagePilot,
		Names: tileNames("PPE Crew", "PPE Crew", "PPE Crew"), AnyOf: role.Strings([]role.Permission{role.DashboardOverview, role.DashboardManager})},
	{Slug: "admin", Kind: launcher.KindApp, Group: "admin", Icon: "admin", Color: "#3b4256", Href: "/admin/", Tier: launcher.TierHere, Stage: launcher.StageLive,
		Names: tileNames("Administration", "Administravimas", "Администрирование"), AnyOf: role.Strings(administration)},
	// Identity documents read from passports and ID cards (ADR 0007): Personnel Documents' alone.
	{Slug: "docs-import", Kind: launcher.KindApp, Group: "people", Icon: "scan", Color: "#5b3f8c", Href: "/apps/docs-import/", Tier: launcher.TierHere, Stage: launcher.StagePOC,
		Names: tileNames("Import Documents", "Dokumentų importas", "Импорт документов"), AnyOf: role.Strings([]role.Permission{role.PersonnelDocumentsManage})},
	// Read first, then find the person (docs/apps/docs-scan-plan.md): Import Documents' successor, Personnel Documents' alone.
	{Slug: "docs-scan", Kind: launcher.KindApp, Group: "people", Icon: "scan", Color: "#2f6f8f", Href: "/apps/docs-scan/", Tier: launcher.TierHere, Stage: launcher.StagePOC,
		Names: tileNames("Scan Documents", "Dokumentų skenavimas", "Сканирование документов"), AnyOf: role.Strings([]role.Permission{role.PersonnelDocumentsManage})},
	// make new-app adds each new published app's tile above this line, in POC (Testers only).
}
