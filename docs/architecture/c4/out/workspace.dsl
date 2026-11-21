workspace "PPE-next2" "C4 model of https://github.com/remisb/ppe-next2 (commit a3d5a9f). Generated from model.mjs - edit the model, not this file." {
    !identifiers flat

    model {
        staff = person "Office staff" "Prepares workwear orders, records receipts, keeps employees, the catalogue and company assets. Roles: employee, manager." ""
        admin = person "Administrator" "Manages users, roles, settings, mail templates, apps and backups; reviews the audit log and security events." ""
        worker = person "Employee (wearer)" "Receives workwear, PPE and equipment; confirms receipt through a one-time link, without signing in." ""
        supplier = person "Supplier" "Delivers workwear and PPE; receives orders as WhatsApp messages." "External"
        provider = person "Mobile operator" "Activates and blocks company SIM cards when asked by email." "External"
        ppe = softwareSystem "PPE-next2 (Workwear & Equipment)" "Internal platform: workwear/PPE orders and receipts, company assets (SIM cards, equipment), personnel files, administration and an app launcher." "" {
            caddy = container "Web server / reverse proxy" "Terminates TLS; serves every SPA bundle and published-app file on one origin with cache headers and CSP; proxies /api, /health, /ready and published-app pages to the API." "Caddy 2.11" ""
            staffApp = container "Staff app" "Create Order, History, employees, catalogue, item sets, company assets, dashboards; public receipt confirmation page. At /" "React 19, TypeScript, Vite, Tailwind" "Web Browser"
            adminApp = container "Administration" "Users, roles, settings, AI usage, mail templates, suppliers, app releases, backups, audit, security, system. At /admin/" "React 19, TypeScript, Vite" "Web Browser"
            launcher = container "App Launcher" "Tiles for every app the user's roles open; apps in testing for Testers. At /apps/" "React 19, TypeScript, Vite" "Web Browser"
            simScan = container "Scan SIMs" "Registers batches of SIM cards with the phone camera. At /apps/sim-scan/" "React SPA, published app (device profile)" "Web Browser"
            docsImport = container "Docs Import" "Reads identity documents (MRZ) in the browser with the camera and crops portraits. At /apps/docs-import/" "React SPA, published app (device profile)" "Web Browser"
            api = container "API" "JSON API for every bounded context (modular monolith): auth and permissions, business rules, PDFs, sealing of sensitive data, audit, scheduled upkeep." "Go 1.27, net/http, muxstack, pgx" "" {
                cRouter = component "HTTP router & access policy" "Every route registered with an explicit rule (public / signed-in / permission); JWT authenticator, permission authorizer, timeouts, logging." "net/http ServeMux, muxstack" ""
                cHealth = component "Health & metrics" "/health, /ready (DB reachable and migrated), /metrics on :9090 (compose network only)." "Prometheus client" ""
                cAuth = component "Auth & sessions" "Sign-in, 15-min access tokens, HttpOnly refresh sessions, editable roles of permissions, throttling, security events." "user, session, role, security; bcrypt, JWT HS256" ""
                cPeople = component "Employees" "Employees, saved sizes, size suggestion from height, photos. Shared kernel for other contexts." "employee, size, employeephoto" ""
                cWorkwear = component "Workwear ordering" "Catalogue, item sets, suppliers; orders with immutable snapshot lines, ORDERED → GIVEN, one-time confirmation links." "catalogue, itemset, order, supplier" ""
                cAssets = component "Company Assets" "SIM cards, equipment, furniture; assignments, connection status, assignment forms, signed copies; PIN/PUK sealed." "asset" ""
                cPersonnel = component "Personnel files" "Identity documents and copies sealed per person, MRZ checks, kept scans, retention and shredding (special-care data)." "personnel/document, scan, mrz, colour" ""
                cAi = component "AI usage" "The one client for AI calls: records model, tokens and cost; monthly budget; sealed OpenAI key." "aiusage" ""
                cLauncher = component "App Launcher & publishing" "Registry of apps, versions and channels; publishes builds; serves each published app's index.html with its CSP." "launcher, publish-app" ""
                cAdmin = component "Administration services" "Organisation settings, mail templates, backup runs (read-only), system and usage figures, dashboards." "settings, mailtemplate, backup, system, usage, dashboard" ""
                cAudit = component "Audit log" "Append-only change events; daily hash seals with trusted timestamps; verification and export." "audit, tsa" ""
                cWiring = component "Cross-context adapters" "Composition root: answers the interfaces each context declares, so no context imports another." "cmd/api/checkers.go" ""
                cPdf = component "PDF rendering" "A4 receipts (EN/RU), assignment forms and registers." "formpdf, registerpdf, pdf-mini" ""
                cSeal = component "Sealbox" "Encrypts sensitive values and file keys with rotating keys from the environment." "sealbox (AEAD, key IDs, rotation)" ""
                cFiles = component "File store" "Upload checks; stores and reads encrypted blobs in object storage." "files, minio-go" ""
                cJobs = component "Upkeep jobs" "Purges old security/error/audit events, seals and verifies audit days, records usage, shreds expired personnel files." "goroutine (jobs.go)" ""
            }
            db = container "Database" "Users, roles, sessions, employees, catalogue, orders, assets, sealed personnel files, audit log and seals, security events, backup runs." "PostgreSQL 18" "Database"
            migrate = container "Migration job" "Runs on every deploy: applies pending migrations and grants, then exits. The API starts only after it succeeds." "psql, plain SQL migrations" "Job"
            backup = container "Backup agent" "Nightly dump (03:00), prune (14 days / last 7), optional encryption; records every run for the Backups screen." "Go, remisb/dbbackup, pg_dump" "Job"
            published = container "Published app store" "Immutable builds of published apps: <profile>/<slug>/<version>/." "Docker volume" "Folder"
        }
        openai = softwareSystem "OpenAI API" "Generates colour ID photos for Personnel files; validates the stored API key." "External"
        tsa = softwareSystem "Timestamp authority" "Public RFC 3161 TSA (DigiCert by default); timestamps the hash of each day's audit seal." "External"
        spaces = softwareSystem "Object storage" "DigitalOcean Spaces (S3 API), private buckets: signed copies, personnel document copies, off-site DB backups." "External"
        uptime = softwareSystem "DigitalOcean Monitoring" "Uptime check on /ready plus droplet alerts; emails the operator." "External"
        acme = softwareSystem "Let's Encrypt" "Issues and renews TLS certificates (ACME)." "External"
        whatsapp = softwareSystem "WhatsApp" "Messaging app on the staff member's phone or desktop." "External"
        mailapp = softwareSystem "Email client" "The staff member's own mail app; sends the emails the app prepares (mailto:). The system sends no email itself." "External"

        staff -> ppe "Orders workwear, records receipts, manages employees and assets" "HTTPS"
        admin -> ppe "Administers users, roles, settings, apps and backups" "HTTPS"
        worker -> ppe "Confirms receipt via one-time link" "HTTPS"
        staff -> whatsapp "Pastes orders for the supplier into"
        whatsapp -> supplier "Delivers order messages to"
        mailapp -> provider "Sends activation / blocking emails to" "SMTP"
        staff -> staffApp "Orders, records receipts, manages assets with" "HTTPS"
        staff -> launcher "Opens apps from" "HTTPS"
        staff -> simScan "Registers SIM cards with" "HTTPS, camera"
        staff -> docsImport "Imports identity documents with" "HTTPS, camera"
        admin -> adminApp "Administers the system with" "HTTPS"
        admin -> launcher "Opens apps from" "HTTPS"
        worker -> staffApp "Confirms receipt on the public page of" "HTTPS, one-time link"
        staffApp -> mailapp "Opens prefilled SIM emails in" "mailto:"
        staffApp -> api "Makes API calls to" "JSON/HTTPS via Caddy /api"
        adminApp -> api "Makes API calls to" "JSON/HTTPS via Caddy /api"
        launcher -> api "Reads the user's app tiles from" "JSON/HTTPS via Caddy /api"
        simScan -> api "Imports scanned SIM cards to" "JSON/HTTPS via Caddy /api"
        docsImport -> api "Creates personnel files through" "JSON/HTTPS via Caddy /api"
        caddy -> api "Proxies /api, /ready and app pages to" "HTTP :8090"
        caddy -> published "Serves published app files from" "read-only mount"
        caddy -> acme "Obtains TLS certificates from" "ACME"
        uptime -> caddy "Checks /ready through" "HTTPS"
        api -> db "Reads from and writes to" "SQL, pgx pool"
        api -> published "Writes published app builds to" "file system"
        api -> spaces "Stores and reads encrypted files in" "S3 API"
        api -> openai "Requests colour photos from" "JSON/HTTPS"
        api -> tsa "Timestamps daily audit seals with" "RFC 3161"
        migrate -> db "Applies schema migrations to" "psql"
        backup -> db "Dumps and records runs in" "pg_dump, SQL"
        backup -> spaces "Uploads backups to (when configured)" "S3 API"
        caddy -> cRouter "Proxies /api/* and app pages to" "HTTP :8090"
        caddy -> cHealth "Proxies /health and /ready to" "HTTP :8090"
        cRouter -> cAuth "Verifies tokens, signs in with"
        cRouter -> cPeople "Routes requests to"
        cRouter -> cWorkwear "Routes requests to"
        cRouter -> cAssets "Routes requests to"
        cRouter -> cPersonnel "Routes requests to"
        cRouter -> cLauncher "Routes requests to"
        cRouter -> cAdmin "Routes requests to"
        cRouter -> cAi "Routes requests to"
        cRouter -> cAudit "Routes requests to"
        cWorkwear -> cWiring "Looks up employees and settings via"
        cAssets -> cWiring "Gets employees and its Mailer via"
        cWiring -> cPeople "Reads employees from"
        cWiring -> cAdmin "Renders mail templates with"
        cWorkwear -> cPdf "Renders receipts with"
        cAssets -> cPdf "Renders assignment forms with"
        cAssets -> cSeal "Seals SIM PIN/PUK with"
        cPersonnel -> cSeal "Seals per-person keys with"
        cAi -> cSeal "Seals the OpenAI key with"
        cAssets -> cFiles "Stores signed copies in"
        cPersonnel -> cFiles "Stores document copies in"
        cPersonnel -> cAi "Makes colour photos through"
        cWorkwear -> cAudit "Records changes in"
        cAssets -> cAudit "Records changes in"
        cPersonnel -> cAudit "Records changes and reads in"
        cJobs -> cAudit "Seals, verifies and purges"
        cJobs -> cPersonnel "Shreds expired files in"
        cJobs -> cAuth "Purges old security events in"
        cAuth -> db "Reads/writes users, sessions, roles" "SQL"
        cPeople -> db "Reads/writes" "SQL"
        cWorkwear -> db "Reads/writes" "SQL"
        cAssets -> db "Reads/writes" "SQL"
        cPersonnel -> db "Reads/writes sealed rows" "SQL"
        cAdmin -> db "Reads/writes" "SQL"
        cLauncher -> db "Reads/writes" "SQL"
        cAi -> db "Records usage in" "SQL"
        cAudit -> db "Appends events and seals to" "SQL"
        cHealth -> db "Pings and checks migrations of" "SQL"
        cFiles -> spaces "Puts and gets objects in" "S3 API, minio-go"
        cAi -> openai "Calls" "JSON/HTTPS"
        cAudit -> tsa "Requests timestamps from" "RFC 3161"
        cLauncher -> published "Writes builds to" "file system"

        deploymentEnvironment "Production" {
            dDevice = deploymentNode "Staff device" "" "Desktop or phone, web browser" {
                containerInstance staffApp
                containerInstance adminApp
                containerInstance launcher
                containerInstance simScan
                containerInstance docsImport
            }
            dDO = deploymentNode "DigitalOcean" "" "Cloud, EU region" {
                dDroplet = deploymentNode "Droplet" "" "Ubuntu, Docker Engine + Compose (project ppe-next2-prod)" {
                    dCaddy = deploymentNode "caddy" "" "Docker: ppe-next2-web (caddy:2.11-alpine + SPA bundles); ports 80, 443" {
                        containerInstance caddy
                    }
                    dApi = deploymentNode "api" "" "Docker: ppe-next2-api; :8090, metrics :9090" {
                        containerInstance api
                    }
                    dMigrate = deploymentNode "migrate" "" "Docker: postgres:18-alpine, one-shot" {
                        containerInstance migrate
                    }
                    dDb = deploymentNode "db" "" "Docker: postgres:18-alpine; volume db-data" {
                        containerInstance db
                    }
                    dBackup = deploymentNode "backup" "" "Docker: ppe-next2-backup; volume backups" {
                        containerInstance backup
                    }
                    dVol = deploymentNode "published" "" "Docker named volume" {
                        containerInstance published
                    }
                }
                dSpaces = deploymentNode "Spaces" "" "S3-compatible object storage" {
                    softwareSystemInstance spaces
                }
                dMon = deploymentNode "Monitoring" "" "Uptime checks, alerts" {
                    softwareSystemInstance uptime
                }
            }
            dOpenAI = deploymentNode "OpenAI" "" "SaaS" {
                softwareSystemInstance openai
            }
            dTsa = deploymentNode "DigiCert" "" "timestamp.digicert.com" {
                softwareSystemInstance tsa
            }
            dLe = deploymentNode "Let's Encrypt" "" "ACME CA" {
                softwareSystemInstance acme
            }
            dDevice -> dCaddy "Loads the apps and calls /api through" "HTTPS :443"
        }
    }

    views {
        systemContext ppe "context" {
            title "System Context diagram for PPE-next2"
            description "Who uses PPE-next2 and which outside systems it depends on. The system sends no email or WhatsApp itself: staff send the text it prepares from their own apps."
            include staff admin worker supplier provider ppe openai tsa spaces uptime acme whatsapp mailapp
            autoLayout tb
        }

        container ppe "containers" {
            title "Container diagram for PPE-next2"
            description "Runtime building blocks. Browsers load every app from one origin through Caddy, so they share one sign-in cookie and need no CORS. The API is a modular monolith over one Postgres."
            include staff admin worker caddy staffApp adminApp launcher simScan docsImport api db migrate backup published openai tsa spaces uptime acme mailapp
            autoLayout tb
        }

        component api "components" {
            title "Component diagram for PPE-next2 – API: request handling and bounded contexts"
            description "Bounded contexts inside the Go API (ADR 0001). No context imports another: cross-context reads go through interfaces answered in the composition root (checkers.go). Every context persists to PostgreSQL through its own repository (postgres.go); those links are in the model but left off this view for readability."
            include caddy cRouter cHealth cAuth cPeople cWorkwear cAssets cPersonnel cAi cLauncher cAdmin cAudit cWiring published
            autoLayout tb
        }

        component api "platform" {
            title "Component diagram for PPE-next2 – API: shared platform services"
            description "How the contexts use the platform: audit trail with daily sealed and timestamped hashes, envelope encryption (Sealbox), encrypted file storage, AI calls metered through one client, PDF rendering, and the upkeep loop that seals, purges and shreds."
            include cWorkwear cAssets cPersonnel cAuth cJobs cAi cAudit cPdf cSeal cFiles spaces openai tsa
            autoLayout tb
        }

        deployment ppe "Production" "deployment" {
            title "Deployment diagram for PPE-next2 – Production"
            description "One droplet, one compose project (docker-compose.prod.yml). Only Caddy publishes ports; the API, metrics and database stay on the compose network."
            include *
            autoLayout tb
        }

        styles {
            element "Element" { color #ffffff }
            element "Person" { background #08427b; shape Person }
            element "Software System" { background #1168bd }
            element "Container" { background #438dd5 }
            element "Component" { background #85bbf0; color #000000 }
            element "External" { background #8a8a8a }
            element "Database" { shape Cylinder }
            element "Web Browser" { shape WebBrowser }
            element "Folder" { shape Folder }
            element "Job" { border dashed }
            relationship "Relationship" { dashed true; color #707070 }
        }
    }
}
