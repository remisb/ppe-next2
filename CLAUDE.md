# CLAUDE.md

This file is how to work in this repository. It is loaded into every session, so it holds only
what most sessions need. More context loads only when it applies:

- `.claude/rules/backend.md`: Go and SQL architecture, the database invariants. Loads for `*.go` and `*.sql`.
- `.claude/rules/frontend.md`: the web workspace. Loads for `web/**`; the binding rules are `web/AGENTS.md`.
- `.claude/rules/e2e.md`: the Playwright suite. Loads for `web/e2e/**`.
- `docs/project-map.md`: what is built and where, area by area (packages, migrations, routes,
  apps, specs). Read the part for the area you change before you change it.
- `docs/deployment.md`: production, the droplet, `prod-*` targets. Read it before deploying.

Do not add "what was built" narrative here. A new area gets a paragraph in `docs/project-map.md`,
its rules go in its spec, and the history is in git and the issues.

## What this is

PPE-next2: workwear, equipment and personnel records for one organisation. It is a Go API
(`cmd/api`, `internal/`) with a modular-monolith layout (one package per domain under
`internal/domain/`, plus `internal/vault`, `internal/personnel`, `internal/audit` and others),
backed by one Postgres. A pnpm workspace in `web/` holds several React apps on one origin: the
staff app `workwear`, Administration `admin`, App Launcher `launcher`, and published trial apps.
It runs on one droplet with docker compose and Caddy. The product contract is
`../PPE-documents/Workwear_Equipment_App_Developer_Logic_Manual.docx`.

## Commands

Copy `.env.example` to `.env` first; the Makefile and docker compose both read it.

```bash
make db-up            # Postgres 18 in Docker (docker-compose.yml), waits until healthy
make migrate          # apply pending internal/db/migrations/*.up.sql via psql in the container
make migrate-down     # revert all; make migrate-status lists applied files
make seed-admin       # create the first admin from API_SEED_USER_*
make seed-demo        # demo data via the services (cmd/api/seed-demo.go); refuses a non-empty DB
make import-sims FILE=sims.csv   # check the SIM card list; COMMIT=yes imports it (prod: make prod-import-sims)
make new-app SLUG=size-helper NAME='Size Helper' NAME_LT='…' NAME_RU='…'   # start a published app from web/templates/published-app, its tile in POC
make backup-once      # back up the dev DB now (docker-compose.yml backup profile; volume ppe-next2-backups)
make run              # go run ./cmd/api
make vet
make lint             # golangci-lint (.golangci.yml) and Biome (web/biome.jsonc)
make test             # go test ./... with API_TEST_DB_DSN blanked, so Postgres tests skip
make db-test-create   # create + migrate the <POSTGRES_DB>_test database (e2e's; Go tests clone their own)
make test-db          # all tests incl. Postgres ones, packages in parallel, each in its own database (refuses if test DSN == main DSN)
make db-test-clean    # drop the Go tests' databases (ppe2_t_*) and templates (ppe2_tmpl_*)
make e2e              # Playwright end-to-end; empties the _test DB, starts API :18090 + Vite :5181
make e2e-caddy        # the same behind deploy/Caddyfile, Caddy in Docker at CI's version (as CI runs it)
go test ./internal/domain/user -run TestAuthenticate   # single test
cd web/e2e && pnpm e2e -g "paper confirmation"   # one e2e step (suite is serial; pnpm e2e waits for the test database's lock)
E2E_APPS= make e2e    # start or publish no published app (E2E_APPS=sim-scan: only it); their steps are skipped
cd web/e2e && pnpm guide   # Help screenshots on phone, tablet, desktop in EN, LT, RU; docs/guide from src/help (empties the _test DB; stamps its seals with DigiCert, so needs the internet; GUIDE_TSA_URL='' skips that)

cd web && pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build   # whole web workspace
pnpm --dir apps/workwear dev                             # http://localhost:5180 (other apps: .claude/rules/frontend.md)
```

Ports and names are chosen not to clash with the sibling PPE-next project (5432/5433,
8080, 5173–5175): Postgres 5442, API 8090, Vite 5180 (Administration 5182, reached through
5180 at `/admin/`; Scan SIMs 5184, at `/apps/sim-scan/`; App Launcher 5186, at `/apps/`; Import Documents
5188, at `/apps/docs-import/`; Scan Documents 5190, at `/apps/docs-scan/`), e2e 18090/5181 (Administration 5183,
Scan SIMs 5185, App Launcher 5187, Import Documents 5189, Scan Documents 5191), compose project
`ppe-next2`, volume `ppe-next2-pgdata`, DB user/databases `ppe2`/`ppe2`/`ppe2_test`. Keep
new ports out of PPE-next's range. Any psql target can point at another DB: `make migrate DB=ppe2_test`.
Go test packages run in parallel: each clones a database of its own (`internal/db/dbtest`).

On this Mac the corepack pnpm shim may be broken: put `~/.cache/node/corepack/v1/pnpm/12.6.0`
first on `PATH`.

## Rules for every change

- **Words**: use the terms and control labels in `docs/ubiquitous-language.md` (EN/LT/RU) in
  code and on screen; add a term there before using it.
- **Permissions, not roles**: a route requires one permission from `internal/domain/role`'s
  catalogue; a screen shows controls by `session.can(...)`. Never check a role by name.
- **API changes** update `web/packages/api-client` (hand-written types and client) in the same change.
- **New route**: an entry in the `policy` table in `cmd/api/routes_test.go`.
- **New audit event**: add it to `audit.Events()` and `AUDIT_EVENTS` (`@ppe/api-client`).
- **Migrations** are append-only once merged; a new table that `ppe_app` must not change goes
  into `internal/db/grants.sql`'s REVOKE line.
- **Every query over `orders`** filters `deleted_at IS NULL` (managers soft-delete orders).
- **Tests**: `docs/testing.md` maps manual rules to tests; update it when adding a rule.
- **User documentation is not updated as part of a change** (the Help text in `src/help/*.ts`,
  its screenshots, `docs/guide`, `pnpm guide`): the user asks for those separately. When a change
  leaves them out of date, say so in one line. Developer docs (`docs/testing.md`, `docs/specs/`,
  `docs/project-map.md`, `web/AGENTS.md`, `.claude/rules/`, this file) are updated with the change.
- **Lint** passes: `make lint` (Go) and `pnpm lint` (web). Claude's edits are formatted by the
  `PostToolUse` hook in `.claude/settings.json`.

## Testing

### Go

- `service_test.go`: table-driven against an in-memory fake repository — no DB; use
  `WithHasher` to skip bcrypt.
- `postgres_test.go`: real Postgres via `dbtest.DSN(t)` (`t.Skip` when `API_TEST_DB_DSN` is
  unset), truncates first.
- `cmd/api/routes_test.go` pins the access policy of every route (stub repos; no DB).
  `cmd/api/api_postgres_test.go` runs HTTP flows against the real repositories, connected
  as `ppe_app` (`internal/db/dbtest.AppPool`, which sets its test password through the
  owner); `TestPostgresAPIRoleIsLeastPrivileged` pins what that role may not do.
- **A database per test package.** `dbtest.DSN` clones each package's database
  (`ppe2_t_<package>_<hash of the directory>`) on `API_TEST_DB_DSN`'s server from a template
  holding every migration and `grants.sql` (`ppe2_tmpl_<hash of them>`, built once when
  missing), so Go test packages, sessions and worktrees run in parallel, without `-p 1` or a
  lock; a rerun drops and clones the package's database again. The user needs CREATEDB
  (`ppe2` is a superuser). `make db-test-clean` drops them all.
- **One e2e run at a time.** Every session and worktree on the machine shares `ppe2_test` and
  the e2e ports, and an e2e run empties the database as it starts. `make e2e`, `make e2e-caddy`
  and web/e2e's `pnpm e2e` and `pnpm guide` hold its lock for the whole run (`cmd/testlock`,
  `internal/db/testlock`: a Postgres advisory lock from a connection named after the run, freed
  when it ends or crashes), waiting while another run holds it and saying which. e2e's
  `prepare-db.ts` refuses to empty anything while another run holds the lock, so a bare
  `playwright test` stops instead of wrecking it.
- The Makefile exports `.env`, so tests that need a var unset must `t.Setenv(key, "")`.
- CI has no compose service: it runs `make migrate PSQL='psql -d <dsn> ...'`, overriding the
  in-container psql the Makefile uses locally.

### End-to-end

One serial spec (`web/e2e/tests/order-lifecycle.spec.ts`) drives the whole lifecycle through
the real UI, API and the `_test` database; CI runs it behind `deploy/Caddyfile`. How it starts,
the Caddy mode and the published apps: `.claude/rules/e2e.md`.

## Source-of-truth docs

- `docs/architecture/` — the context map and the ADRs (0001 HR and timesheets, proposed; 0002
  permissions; 0003 security log; 0004 Company Assets; 0005 SIM codes and Scan SIMs; 0006 App
  Launcher; 0007 Personnel files and AI usage; 0008 Document Vault; 0009 App Launcher as a reusable
  module, `github.com/remisb/applauncher`, private, required at a tag, and its npm packages
  `@remisb/launcher-core`/`-react` installed from it at a tag; steps 1–4 built).
- `docs/domain-service-contract.md` — binding rules for every Go domain service. Read it
  before touching `internal/domain/` or `cmd/api/`.
- `docs/specs/<name>-service.md` — per-service requirements (`user-service.md` and
  `session-service.md` cover sign-in).
- `docs/project-map.md` — what is built and where.
- `docs/testing.md` — manual rules and status transitions mapped to their tests.
- `docs/backups.md` — running the backup agent, restoring, and upgrading Postgres.
- `docs/monitoring.md` — `/health`, `/ready`, the healthcheck, log rotation, the external
  uptime check and droplet alerts, and what to look at when one fires.
- `docs/deployment.md` — the production stack and how to deploy.
- `docs/privacy/` — the DPIA note and the document retention policy.
- `docs/ubiquitous-language.md` — the project's terms and the labels of the domain's controls
  (EN/LT/RU), and the words to avoid.
- `docs/ux/ui-ux-guidelines.md`, `docs/ui-language.md`, `docs/ux/screen-header-toolbar.md` —
  UI and UX guidelines, the UI language of the apps, the screen header and toolbar.
- `docs/ux/app-launcher-handbook.md`, `docs/ux/company-assets-ux-review.md` — App Launcher as
  built; the Company Assets brief against the app.
- `web/AGENTS.md` — binding rules for frontend apps.
