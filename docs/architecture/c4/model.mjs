// C4 model of github.com/remisb/ppe-next2 — single source of truth.
// Diagrams (HTML/SVG) and the Structurizr DSL are both generated from this file.
// Analysed commit: a3d5a9f (2026-11-15).

export const meta = {
  name: "PPE-next2",
  repo: "https://github.com/remisb/ppe-next2",
  commit: "a3d5a9f",
  commitDate: "2026-11-15",
  generated: "2026-11-16",
};

// kind: person | system | container | component
// ext: true = outside the system of interest (grey)
// shape: browser | db | folder | job (optional)
// parent: id of enclosing element (system > container > component)
export const elements = [
  // ── People ───────────────────────────────────────────────
  { id: "staff", kind: "person", name: "Office staff",
    desc: "Prepares workwear orders, records receipts, keeps employees, the catalogue and company assets. Roles: employee, manager." },
  { id: "admin", kind: "person", name: "Administrator",
    desc: "Manages users, roles, settings, mail templates, apps and backups; reviews the audit log and security events." },
  { id: "worker", kind: "person", name: "Employee (wearer)",
    desc: "Receives workwear, PPE and equipment; confirms receipt through a one-time link, without signing in." },
  { id: "supplier", kind: "person", ext: true, name: "Supplier",
    desc: "Delivers workwear and PPE; receives orders as WhatsApp messages." },
  { id: "provider", kind: "person", ext: true, name: "Mobile operator",
    desc: "Activates and blocks company SIM cards when asked by email." },

  // ── Software system of interest ──────────────────────────
  { id: "ppe", kind: "system", name: "PPE-next2 (Workwear & Equipment)",
    desc: "Internal platform: workwear/PPE orders and receipts, company assets (SIM cards, equipment), personnel files, administration and an app launcher." },

  // ── External systems ─────────────────────────────────────
  { id: "openai", kind: "system", ext: true, name: "OpenAI API",
    desc: "Generates colour ID photos for Personnel files; validates the stored API key." },
  { id: "tsa", kind: "system", ext: true, name: "Timestamp authority",
    desc: "Public RFC 3161 TSA (DigiCert by default); timestamps the hash of each day's audit seal." },
  { id: "spaces", kind: "system", ext: true, name: "Object storage",
    desc: "DigitalOcean Spaces (S3 API), private buckets: signed copies, personnel document copies, off-site DB backups." },
  { id: "uptime", kind: "system", ext: true, name: "DigitalOcean Monitoring",
    desc: "Uptime check on /ready plus droplet alerts; emails the operator." },
  { id: "acme", kind: "system", ext: true, name: "Let's Encrypt",
    desc: "Issues and renews TLS certificates (ACME)." },
  { id: "whatsapp", kind: "system", ext: true, name: "WhatsApp",
    desc: "Messaging app on the staff member's phone or desktop." },
  { id: "mailapp", kind: "system", ext: true, name: "Email client",
    desc: "The staff member's own mail app; sends the emails the app prepares (mailto:). The system sends no email itself." },

  // ── Containers of PPE-next2 ──────────────────────────────
  { id: "caddy", kind: "container", parent: "ppe", name: "Web server / reverse proxy", tech: "Caddy 2.11",
    desc: "Terminates TLS; serves every SPA bundle and published-app file on one origin with cache headers and CSP; proxies /api, /health, /ready and published-app pages to the API." },
  { id: "staffApp", kind: "container", parent: "ppe", shape: "browser", name: "Staff app", tech: "React 19, TypeScript, Vite, Tailwind",
    desc: "Create Order, History, employees, catalogue, item sets, company assets, dashboards; public receipt confirmation page. At /" },
  { id: "adminApp", kind: "container", parent: "ppe", shape: "browser", name: "Administration", tech: "React 19, TypeScript, Vite",
    desc: "Users, roles, settings, AI usage, mail templates, suppliers, app releases, backups, audit, security, system. At /admin/" },
  { id: "launcher", kind: "container", parent: "ppe", shape: "browser", name: "App Launcher", tech: "React 19, TypeScript, Vite",
    desc: "Tiles for every app the user's roles open; apps in testing for Testers. At /apps/" },
  { id: "simScan", kind: "container", parent: "ppe", shape: "browser", name: "Scan SIMs", tech: "React SPA, published app (device profile)",
    desc: "Registers batches of SIM cards with the phone camera. At /apps/sim-scan/" },
  { id: "docsImport", kind: "container", parent: "ppe", shape: "browser", name: "Docs Import", tech: "React SPA, published app (device profile)",
    desc: "Reads identity documents (MRZ) in the browser with the camera and crops portraits. At /apps/docs-import/" },
  { id: "api", kind: "container", parent: "ppe", name: "API", tech: "Go 1.27, net/http, muxstack, pgx",
    desc: "JSON API for every bounded context (modular monolith): auth and permissions, business rules, PDFs, sealing of sensitive data, audit, scheduled upkeep." },
  { id: "db", kind: "container", parent: "ppe", shape: "db", name: "Database", tech: "PostgreSQL 18",
    desc: "Users, roles, sessions, employees, catalogue, orders, assets, sealed personnel files, audit log and seals, security events, backup runs." },
  { id: "migrate", kind: "container", parent: "ppe", shape: "job", name: "Migration job", tech: "psql, plain SQL migrations",
    desc: "Runs on every deploy: applies pending migrations and grants, then exits. The API starts only after it succeeds." },
  { id: "backup", kind: "container", parent: "ppe", shape: "job", name: "Backup agent", tech: "Go, remisb/dbbackup, pg_dump",
    desc: "Nightly dump (03:00), prune (14 days / last 7), optional encryption; records every run for the Backups screen." },
  { id: "published", kind: "container", parent: "ppe", shape: "folder", name: "Published app store", tech: "Docker volume",
    desc: "Immutable builds of published apps: <profile>/<slug>/<version>/." },

  // ── Components of the API ────────────────────────────────
  { id: "cRouter", kind: "component", parent: "api", name: "HTTP router & access policy", tech: "net/http ServeMux, muxstack",
    desc: "Every route registered with an explicit rule (public / signed-in / permission); JWT authenticator, permission authorizer, timeouts, logging." },
  { id: "cHealth", kind: "component", parent: "api", name: "Health & metrics", tech: "Prometheus client",
    desc: "/health, /ready (DB reachable and migrated), /metrics on :9090 (compose network only)." },
  { id: "cAuth", kind: "component", parent: "api", name: "Auth & sessions", tech: "user, session, role, security; bcrypt, JWT HS256",
    desc: "Sign-in, 15-min access tokens, HttpOnly refresh sessions, editable roles of permissions, throttling, security events." },
  { id: "cPeople", kind: "component", parent: "api", name: "Employees", tech: "employee, size, employeephoto",
    desc: "Employees, saved sizes, size suggestion from height, photos. Shared kernel for other contexts." },
  { id: "cWorkwear", kind: "component", parent: "api", name: "Workwear ordering", tech: "catalogue, itemset, order, supplier",
    desc: "Catalogue, item sets, suppliers; orders with immutable snapshot lines, ORDERED → GIVEN, one-time confirmation links." },
  { id: "cAssets", kind: "component", parent: "api", name: "Company Assets", tech: "asset",
    desc: "SIM cards, equipment, furniture; assignments, connection status, assignment forms, signed copies; PIN/PUK sealed." },
  { id: "cPersonnel", kind: "component", parent: "api", name: "Personnel files", tech: "personnel/document, scan, mrz, colour",
    desc: "Identity documents and copies sealed per person, MRZ checks, kept scans, retention and shredding (special-care data)." },
  { id: "cAi", kind: "component", parent: "api", name: "AI usage", tech: "aiusage",
    desc: "The one client for AI calls: records model, tokens and cost; monthly budget; sealed OpenAI key." },
  { id: "cLauncher", kind: "component", parent: "api", name: "App Launcher & publishing", tech: "launcher, publish-app",
    desc: "Registry of apps, versions and channels; publishes builds; serves each published app's index.html with its CSP." },
  { id: "cAdmin", kind: "component", parent: "api", name: "Administration services", tech: "settings, mailtemplate, backup, system, usage, dashboard",
    desc: "Organisation settings, mail templates, backup runs (read-only), system and usage figures, dashboards." },
  { id: "cAudit", kind: "component", parent: "api", name: "Audit log", tech: "audit, tsa",
    desc: "Append-only change events; daily hash seals with trusted timestamps; verification and export." },
  { id: "cWiring", kind: "component", parent: "api", name: "Cross-context adapters", tech: "cmd/api/checkers.go",
    desc: "Composition root: answers the interfaces each context declares, so no context imports another." },
  { id: "cPdf", kind: "component", parent: "api", name: "PDF rendering", tech: "formpdf, registerpdf, pdf-mini",
    desc: "A4 receipts (EN/RU), assignment forms and registers." },
  { id: "cSeal", kind: "component", parent: "api", name: "Sealbox", tech: "sealbox (AEAD, key IDs, rotation)",
    desc: "Encrypts sensitive values and file keys with rotating keys from the environment." },
  { id: "cFiles", kind: "component", parent: "api", name: "File store", tech: "files, minio-go",
    desc: "Upload checks; stores and reads encrypted blobs in object storage." },
  { id: "cJobs", kind: "component", parent: "api", name: "Upkeep jobs", tech: "goroutine (jobs.go)",
    desc: "Purges old security/error/audit events, seals and verifies audit days, records usage, shreds expired personnel files." },
];

// Relationships are modelled at the lowest level that is true.
// Higher-level views show them as implied relationships (as Structurizr does),
// unless an explicit relationship between the visible elements exists.
export const relationships = [
  // System-context level (explicit summaries)
  ["staff", "ppe", "Orders workwear, records receipts, manages employees and assets", "HTTPS"],
  ["admin", "ppe", "Administers users, roles, settings, apps and backups", "HTTPS"],
  ["worker", "ppe", "Confirms receipt via one-time link", "HTTPS"],
  ["staff", "whatsapp", "Pastes orders for the supplier into", ""],
  ["whatsapp", "supplier", "Delivers order messages to", ""],
  ["mailapp", "provider", "Sends activation / blocking emails to", "SMTP"],

  // Container level
  ["staff", "staffApp", "Orders, records receipts, manages assets with", "HTTPS"],
  ["staff", "launcher", "Opens apps from", "HTTPS"],
  ["staff", "simScan", "Registers SIM cards with", "HTTPS, camera"],
  ["staff", "docsImport", "Imports identity documents with", "HTTPS, camera"],
  ["admin", "adminApp", "Administers the system with", "HTTPS"],
  ["admin", "launcher", "Opens apps from", "HTTPS"],
  ["worker", "staffApp", "Confirms receipt on the public page of", "HTTPS, one-time link"],
  ["staffApp", "mailapp", "Opens prefilled SIM emails in", "mailto:"],


  ["staffApp", "api", "Makes API calls to", "JSON/HTTPS via Caddy /api"],
  ["adminApp", "api", "Makes API calls to", "JSON/HTTPS via Caddy /api"],
  ["launcher", "api", "Reads the user's app tiles from", "JSON/HTTPS via Caddy /api"],
  ["simScan", "api", "Imports scanned SIM cards to", "JSON/HTTPS via Caddy /api"],
  ["docsImport", "api", "Creates personnel files through", "JSON/HTTPS via Caddy /api"],

  ["caddy", "api", "Proxies /api, /ready and app pages to", "HTTP :8090"],
  ["caddy", "published", "Serves published app files from", "read-only mount"],
  ["caddy", "acme", "Obtains TLS certificates from", "ACME"],
  ["uptime", "caddy", "Checks /ready through", "HTTPS"],

  ["api", "db", "Reads from and writes to", "SQL, pgx pool"],
  ["api", "published", "Writes published app builds to", "file system"],
  ["api", "spaces", "Stores and reads encrypted files in", "S3 API"],
  ["api", "openai", "Requests colour photos from", "JSON/HTTPS"],
  ["api", "tsa", "Timestamps daily audit seals with", "RFC 3161"],
  ["migrate", "db", "Applies schema migrations to", "psql"],
  ["backup", "db", "Dumps and records runs in", "pg_dump, SQL"],
  ["backup", "spaces", "Uploads backups to (when configured)", "S3 API"],

  // Component level (API)
  ["caddy", "cRouter", "Proxies /api/* and app pages to", "HTTP :8090"],
  ["caddy", "cHealth", "Proxies /health and /ready to", "HTTP :8090"],
  ["cRouter", "cAuth", "Verifies tokens, signs in with", ""],
  ["cRouter", "cPeople", "Routes requests to", ""],
  ["cRouter", "cWorkwear", "Routes requests to", ""],
  ["cRouter", "cAssets", "Routes requests to", ""],
  ["cRouter", "cPersonnel", "Routes requests to", ""],
  ["cRouter", "cLauncher", "Routes requests to", ""],
  ["cRouter", "cAdmin", "Routes requests to", ""],
  ["cRouter", "cAi", "Routes requests to", ""],
  ["cRouter", "cAudit", "Routes requests to", ""],

  ["cWorkwear", "cWiring", "Looks up employees and settings via", ""],
  ["cAssets", "cWiring", "Gets employees and its Mailer via", ""],
  ["cWiring", "cPeople", "Reads employees from", ""],
  ["cWiring", "cAdmin", "Renders mail templates with", ""],
  ["cWorkwear", "cPdf", "Renders receipts with", ""],
  ["cAssets", "cPdf", "Renders assignment forms with", ""],
  ["cAssets", "cSeal", "Seals SIM PIN/PUK with", ""],
  ["cPersonnel", "cSeal", "Seals per-person keys with", ""],
  ["cAi", "cSeal", "Seals the OpenAI key with", ""],
  ["cAssets", "cFiles", "Stores signed copies in", ""],
  ["cPersonnel", "cFiles", "Stores document copies in", ""],
  ["cPersonnel", "cAi", "Makes colour photos through", ""],
  ["cWorkwear", "cAudit", "Records changes in", ""],
  ["cAssets", "cAudit", "Records changes in", ""],
  ["cPersonnel", "cAudit", "Records changes and reads in", ""],
  ["cJobs", "cAudit", "Seals, verifies and purges", ""],
  ["cJobs", "cPersonnel", "Shreds expired files in", ""],
  ["cJobs", "cAuth", "Purges old security events in", ""],

  ["cAuth", "db", "Reads/writes users, sessions, roles", "SQL"],
  ["cPeople", "db", "Reads/writes", "SQL"],
  ["cWorkwear", "db", "Reads/writes", "SQL"],
  ["cAssets", "db", "Reads/writes", "SQL"],
  ["cPersonnel", "db", "Reads/writes sealed rows", "SQL"],
  ["cAdmin", "db", "Reads/writes", "SQL"],
  ["cLauncher", "db", "Reads/writes", "SQL"],
  ["cAi", "db", "Records usage in", "SQL"],
  ["cAudit", "db", "Appends events and seals to", "SQL"],
  ["cHealth", "db", "Pings and checks migrations of", "SQL"],
  ["cFiles", "spaces", "Puts and gets objects in", "S3 API, minio-go"],
  ["cAi", "openai", "Calls", "JSON/HTTPS"],
  ["cAudit", "tsa", "Requests timestamps from", "RFC 3161"],
  ["cLauncher", "published", "Writes builds to", "file system"],
];

// ── Deployment: production (docker-compose.prod.yml) ─────────
// node: { id, name, tech, desc, children: [nodes], instances: [element ids] }
export const deployment = {
  env: "Production",
  // Node-level links drawn instead of the SPA → API container relationships,
  // because on the wire every browser request goes to Caddy first.
  links: [["dDevice", "dCaddy", "Loads the apps and calls /api through", "HTTPS :443"]],
  hideInstanceLinksFrom: ["staffApp", "adminApp", "launcher", "simScan", "docsImport"],
  nodes: [
    { id: "dDevice", name: "Staff device", tech: "Desktop or phone, web browser",
      instances: ["staffApp", "adminApp", "launcher", "simScan", "docsImport"] },
    { id: "dDO", name: "DigitalOcean", tech: "Cloud, EU region", children: [
      { id: "dDroplet", name: "Droplet", tech: "Ubuntu, Docker Engine + Compose (project ppe-next2-prod)", children: [
        { id: "dCaddy", name: "caddy", tech: "Docker: ppe-next2-web (caddy:2.11-alpine + SPA bundles); ports 80, 443", instances: ["caddy"] },
        { id: "dApi", name: "api", tech: "Docker: ppe-next2-api; :8090, metrics :9090", instances: ["api"] },
        { id: "dMigrate", name: "migrate", tech: "Docker: postgres:18-alpine, one-shot", instances: ["migrate"] },
        { id: "dDb", name: "db", tech: "Docker: postgres:18-alpine; volume db-data", instances: ["db"] },
        { id: "dBackup", name: "backup", tech: "Docker: ppe-next2-backup; volume backups", instances: ["backup"] },
        { id: "dVol", name: "published", tech: "Docker named volume", instances: ["published"] },
      ]},
      { id: "dSpaces", name: "Spaces", tech: "S3-compatible object storage", instances: ["spaces"] },
      { id: "dMon", name: "Monitoring", tech: "Uptime checks, alerts", instances: ["uptime"] },
    ]},
    { id: "dOpenAI", name: "OpenAI", tech: "SaaS", instances: ["openai"] },
    { id: "dTsa", name: "DigiCert", tech: "timestamp.digicert.com", instances: ["tsa"] },
    { id: "dLe", name: "Let's Encrypt", tech: "ACME CA", instances: ["acme"] },
  ],
};

export const views = [
  { key: "context", type: "SystemContext", title: "System Context diagram for PPE-next2",
    scope: "ppe",
    include: ["staff", "admin", "worker", "supplier", "provider", "ppe", "openai", "tsa", "spaces", "uptime", "acme", "whatsapp", "mailapp"],
    note: "Who uses PPE-next2 and which outside systems it depends on. The system sends no email or WhatsApp itself: staff send the text it prepares from their own apps." },
  { key: "containers", type: "Container", title: "Container diagram for PPE-next2",
    scope: "ppe", boundary: "ppe",
    include: ["staff", "admin", "worker", "caddy", "staffApp", "adminApp", "launcher", "simScan", "docsImport", "api", "db", "migrate", "backup", "published", "openai", "tsa", "spaces", "uptime", "acme", "mailapp"],
    note: "Runtime building blocks. Browsers load every app from one origin through Caddy, so they share one sign-in cookie and need no CORS. The API is a modular monolith over one Postgres." },
  { key: "components", type: "Component", title: "Component diagram for PPE-next2 – API: request handling and bounded contexts",
    scope: "api", boundary: "api",
    include: ["caddy", "cRouter", "cHealth", "cAuth", "cPeople", "cWorkwear", "cAssets", "cPersonnel", "cAi", "cLauncher", "cAdmin", "cAudit", "cWiring", "published"],
    note: "Bounded contexts inside the Go API (ADR 0001). No context imports another: cross-context reads go through interfaces answered in the composition root (checkers.go). Every context persists to PostgreSQL through its own repository (postgres.go); those links are in the model but left off this view for readability." },
  { key: "platform", type: "Component", title: "Component diagram for PPE-next2 – API: shared platform services",
    scope: "api", boundary: "api",
    include: ["cWorkwear", "cAssets", "cPersonnel", "cAuth", "cJobs", "cAi", "cAudit", "cPdf", "cSeal", "cFiles", "spaces", "openai", "tsa"],
    note: "How the contexts use the platform: audit trail with daily sealed and timestamped hashes, envelope encryption (Sealbox), encrypted file storage, AI calls metered through one client, PDF rendering, and the upkeep loop that seals, purges and shreds." },
  { key: "deployment", type: "Deployment", title: "Deployment diagram for PPE-next2 – Production",
    scope: "ppe", env: "Production",
    note: "One droplet, one compose project (docker-compose.prod.yml). Only Caddy publishes ports; the API, metrics and database stay on the compose network." },
];
