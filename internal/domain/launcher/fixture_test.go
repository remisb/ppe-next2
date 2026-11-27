package launcher

// A host like this site, for the registry's tests: a permission catalogue,
// three languages, four groups, the pictures, and tiles like this site's.

const (
	pDashboardOverview        = "dashboard.overview"
	pDashboardManager         = "dashboard.manager"
	pDashboardEmployee        = "dashboard.employee"
	pItemSetsRead             = "item_sets.read"
	pSIMCardsRead             = "sim_cards.read"
	pSIMCardsManage           = "sim_cards.manage"
	pEquipmentRead            = "equipment.read"
	pAssetsManage             = "assets.manage"
	pPersonnelDocumentsManage = "personnel.documents.manage"
	pUsersManage              = "users.manage"
	pRolesManage              = "roles.manage"
	pSettingsManage           = "settings.manage"
	pMailTemplatesManage      = "mail_templates.manage"
	pSuppliersManage          = "suppliers.manage"
	pCompaniesManage          = "companies.manage"
	pBackupsRead              = "backups.read"
	pAuditRead                = "audit.read"
	pSecurityRead             = "security.read"
	pSystemRead               = "system.read"
	pUsageRead                = "usage.read"
	pAppsManage               = "apps.manage"
	pAppsPreview              = "apps.preview"
)

var testConfig = Config{
	Permissions: []string{pDashboardOverview, pDashboardManager, pDashboardEmployee, pItemSetsRead, pSIMCardsRead, pSIMCardsManage, pEquipmentRead, pAssetsManage, pPersonnelDocumentsManage, pUsersManage, pRolesManage, pSettingsManage, pMailTemplatesManage, pSuppliersManage, pCompaniesManage, pBackupsRead, pAuditRead, pSecurityRead, pSystemRead, pUsageRead, pAppsManage, pAppsPreview},
	Preview:     pAppsPreview,
	Languages:   []string{"en", "lt", "ru"},
	Groups:      []Group{"workwear", "assets", "people", "admin"},
	Icons: []string{
		"shirt", "order", "orders", "employees", "dashboard", "sim", "equipment", "scan", "crew", "admin", "help",
		"box", "flask", "pen", "check", "chart", "calendar", "truck", "wrench",
	},
}

var testAdministration = []string{
	pUsersManage, pRolesManage, pSettingsManage, pMailTemplatesManage, pSuppliersManage, pCompaniesManage, pBackupsRead,
	pAuditRead, pSecurityRead, pSystemRead, pUsageRead, pAppsManage,
}

var testTiles = []App{
	{Slug: "workwear", Kind: KindApp, Group: "workwear", Icon: "shirt", Color: "#1c2060", Href: "/", Tier: TierHere, Stage: StageLive,
		Names: Names{"en": "Workwear & Equipment", "lt": "Darbo drabužiai ir įranga", "ru": "Спецодежда и снаряжение"}},
	{Slug: "dashboard", Kind: KindShortcut, Parent: "workwear", Group: "workwear", Icon: "dashboard", Color: "#23703f", Href: "/", Tier: TierHere, Stage: StageLive,
		Names: Names{"en": "Dashboard", "lt": "Suvestinė", "ru": "Сводка"},
		AnyOf: []string{pDashboardOverview, pDashboardManager, pDashboardEmployee}},
	{Slug: "create-order", Kind: KindShortcut, Parent: "workwear", Group: "workwear", Icon: "order", Color: "#3341a8", Href: "/orders/new", Tier: TierHere, Stage: StageLive,
		Names: Names{"en": "Create Order", "lt": "Kurti užsakymą", "ru": "Создать заказ"}},
	{Slug: "orders", Kind: KindShortcut, Parent: "workwear", Group: "workwear", Icon: "orders", Color: "#2a5fb4", Href: "/orders", Tier: TierHere, Stage: StageLive,
		Names: Names{"en": "Orders", "lt": "Užsakymai", "ru": "Заказы"}},
	{Slug: "employees", Kind: KindShortcut, Parent: "workwear", Group: "workwear", Icon: "employees", Color: "#5b4bb3", Href: "/employees", Tier: TierHere, Stage: StageLive,
		Names: Names{"en": "Employees", "lt": "Darbuotojai", "ru": "Сотрудники"}},
	{Slug: "help", Kind: KindShortcut, Parent: "workwear", Group: "workwear", Icon: "help", Color: "#5b6475", Href: "/help", Tier: TierHere, Stage: StageLive,
		Names: Names{"en": "Help", "lt": "Pagalba", "ru": "Справка"}},
	{Slug: "sim-cards", Kind: KindShortcut, Parent: "workwear", Group: "assets", Icon: "sim", Color: "#0e7068", Href: "/assets/sim-cards", Tier: TierHere, Stage: StageLive,
		Names: Names{"en": "SIM Cards", "lt": "SIM kortelės", "ru": "SIM-карты"}, AnyOf: []string{pSIMCardsRead}},
	{Slug: "equipment", Kind: KindShortcut, Parent: "workwear", Group: "assets", Icon: "equipment", Color: "#7a4e14", Href: "/assets/equipment", Tier: TierHere, Stage: StageLive,
		Names: Names{"en": "Equipment", "lt": "Įranga", "ru": "Оборудование"}, AnyOf: []string{pEquipmentRead}},
	{Slug: "sim-scan", Kind: KindApp, Group: "assets", Icon: "scan", Color: "#0f5f8a", Href: "/apps/sim-scan/", Tier: TierHere, Stage: StagePilot,
		Names: Names{"en": "Scan SIMs", "lt": "Skenuoti SIM", "ru": "Сканировать SIM"}, AnyOf: []string{pSIMCardsManage}},
	// Who plans crews: administrators and managers, by their dashboards.
	{Slug: "crew", Kind: KindApp, Group: "people", Icon: "crew", Color: "#9a4f0a", Href: "https://crew.167.71.68.195.sslip.io/", Tier: TierLinked, Stage: StagePilot,
		Names: Names{"en": "PPE Crew", "lt": "PPE Crew", "ru": "PPE Crew"}, AnyOf: []string{pDashboardOverview, pDashboardManager}},
	{Slug: "admin", Kind: KindApp, Group: "admin", Icon: "admin", Color: "#3b4256", Href: "/admin/", Tier: TierHere, Stage: StageLive,
		Names: Names{"en": "Administration", "lt": "Administravimas", "ru": "Администрирование"}, AnyOf: testAdministration},
	// Identity documents read from passports and ID cards (ADR 0007): Personnel Documents' alone.
	{Slug: "docs-import", Kind: KindApp, Group: "people", Icon: "scan", Color: "#5b3f8c", Href: "/apps/docs-import/", Tier: TierHere, Stage: StagePOC,
		Names: Names{"en": "Import Documents", "lt": "Dokumentų importas", "ru": "Импорт документов"}, AnyOf: []string{pPersonnelDocumentsManage}},
	// Read first, then find the person (docs/apps/docs-scan-plan.md): Import Documents' successor, Personnel Documents' alone.
	{Slug: "docs-scan", Kind: KindApp, Group: "people", Icon: "scan", Color: "#2f6f8f", Href: "/apps/docs-scan/", Tier: TierHere, Stage: StagePOC,
		Names: Names{"en": "Scan Documents", "lt": "Dokumentų skenavimas", "ru": "Сканирование документов"}, AnyOf: []string{pPersonnelDocumentsManage}},
}
