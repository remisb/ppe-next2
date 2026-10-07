# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Early build-out, following the slice plan derived from the Developer Logic Manual.
Implemented: the Go API skeleton, the **user service** (JWT login, roles
`admin`/`manager`/`employee`), and Slice 1 — migrations 0002–0007 (audit, employees,
catalogue, item sets, orders + snapshot lines, confirmations), `internal/audit`,
`internal/domain/size` (vocabulary + resolution rules), entity types for all domains, and
Slice 2 — employee and catalogue services with routes and audit events — and Slice 3:
item sets, Create Order resolution (`order/resolve.go`, read-only), and the
`web/apps/workwear` app (Create Order, Employees with a per-employee page of items given,
Item Catalogue with a per-item page, Item Sets, and Users for admins) — and
Slice 4: Mark as Ordered (`POST /api/v1/orders`, snapshot copy in one transaction) and
Copy for WhatsApp — and Slice 5: History, the Orders screen at `/orders` (`GET /api/v1/orders`, query-parameter filters
in the organisation timezone `API_ORG_TIMEZONE`, server-computed `usage_months`).
— and Slice 6: confirmation links (hashed tokens, sent in request bodies), paper
confirmation, in-person confirmation on a staff device (hand-over mode, method `IN_PERSON`,
an addition to the manual), idempotent ORDERED → GIVEN, and the locked bilingual receipt with document
hash and A4 print (`order/confirmation.go`, `order/receipt.go`, `web/.../routes/confirm.tsx`).
The public `/confirm/<token>` page renders before the sign-in gate. An administrator starts on the
Dashboard, a manager on the Manager Dashboard and the employee role on the Employee
Dashboard (`internal/domain/dashboard`, read-only figures, `GET /api/v1/dashboard` admins
only, `/dashboard/manager` managers only, `/dashboard/employee` the employee role only, for
the signed-in user's own orders; spec `docs/specs/dashboard-service.md`). Slice 7 added the
Playwright e2e suite (`web/e2e`), CI (`.github/workflows/ci.yml`) and `docs/testing.md`,
which maps every manual §7 rule and status transition to its tests. Administrators set the
supplier's WhatsApp group on Settings (`internal/domain/settings`, migration 0018, one row
at most; spec `docs/specs/settings-service.md`), which Copy for WhatsApp opens for order messages.
Database backups: the `backup` compose service is the agent from the separate library
`github.com/remisb/dbbackup` (local checkout `../../remis-libs/dbbackup`), which dumps
Postgres on a schedule and records each run in `dbbackup_runs`/`dbbackup_agents`
(migration 0019, dbbackup's schema copied verbatim); administrators read them on the
Backups screen and a Dashboard card (`internal/domain/backup`, `GET /api/v1/backups`, read-only;
spec `docs/specs/backup-service.md`, operations and Postgres upgrades `docs/backups.md`).
Sign-ins are sessions (`internal/domain/session`, migration 0020, spec
`docs/specs/session-service.md`): an HttpOnly refresh cookie rotated on every refresh, with
reuse detection, "Keep me signed in" (30 days, 14 idle; else 12h and the browser's life),
signed-in devices on Account, sessions ended on password change or reset, deactivation and
deletion, and a recent sign-in (password within `API_RECENT_SIGN_IN`) for managing users.
Access is by **permission** (ADR 0002): a fixed catalogue in `internal/domain/role`
(`permission.go`), bundled into **roles** that are rows (migration 0022: `roles`,
`role_permissions`, `user_roles`; spec `docs/specs/role-service.md`). The built-in
Administrator, Manager and Employee reproduce the old three roles; administrators add and
change others on Roles & permissions. The token's `perms` claim carries what the user's
roles allow. **Administration** is a second web app at `/admin/` (`web/apps/admin`: Users,
Roles & permissions, Audit log, Settings, Backups) on the staff app's origin, sharing its sign-in and
the packages `@ppe/ui`, `@ppe/app-shell`, `@ppe/i18n`, `@ppe/backups` and `@ppe/audit`; the
administrator's Dashboard stays in the staff app. The **Audit log** (`audit.read`, migration
0023, spec `docs/specs/audit-service.md`) reads every recorded change with the request,
sign-in and app it was made in; employees, catalogue items and orders show their own
**Changes** in the staff app (the glossary's "History" is Orders, so not that word).

Database-enforced invariants worth knowing: `audit_events` and `order_lines` reject
UPDATE/DELETE via triggers; `orders` allows only `ORDERED`/`GIVEN` and a CHECK ties the
`given_*` columns to the status; a catalogue item's accounting price and service period are
nullable (Mark as Ordered must refuse such items), while order-line snapshots require them.
An item also has an optional purchase price (migration 0021), snapshotted on order lines
but shown on no order or record. The app labels the accounting price "Price"; the record's
`unit_price_cents` key holds it and never changes, because it is part of the document hash.
Users hold roles only through `user_roles` (no `users.roles` column since 0022); the
built-in roles have fixed ids (`role.AdminID` …), Administrator is never changed or
deleted, and at least one active user always holds it (checked after each user write under
an advisory lock). `TRUNCATE users CASCADE` also empties `roles` (actor keys), so Postgres
tests and e2e setup call `role.EnsureBuiltins` after it (`-seed-admin` does).
A manager may
soft-delete an order (`DELETE /api/v1/orders/{id}`, manager role only, migration 0015), so
every query over `orders`, the dashboards' included, must filter `deleted_at IS NULL`; the
dashboard Postgres tests seed deleted orders to catch one that does not. Postgres tests
must `TRUNCATE ... CASCADE` because of the actor foreign keys.

## Commands

Copy `.env.example` to `.env` first; the Makefile and docker compose both read it.

```bash
make db-up            # Postgres 18 in Docker (docker-compose.yml), waits until healthy
make migrate          # apply pending internal/db/migrations/*.up.sql via psql in the container
make migrate-down     # revert all; make migrate-status lists applied files
make seed-admin       # create the first admin from API_SEED_USER_*
make seed-demo        # demo data via the services (cmd/api/seed-demo.go); refuses a non-empty DB
make backup-once      # back up the dev DB now (docker-compose.yml backup profile; volume ppe-next2-backups)
make run              # go run ./cmd/api
make vet
make test             # go test -p 1 ./... — Postgres tests skip without API_TEST_DB_DSN
make db-test-create   # create + migrate the <POSTGRES_DB>_test database
make test-db          # all tests incl. Postgres ones (refuses if test DSN == main DSN)
make e2e              # Playwright end-to-end; empties the _test DB, starts API :18090 + Vite :5181
go test ./internal/domain/user -run TestAuthenticate   # single test
cd web/e2e && pnpm exec playwright test -g "paper confirmation"   # one e2e step (suite is serial)
cd web/e2e && pnpm guide   # Help screenshots on phone, tablet, desktop in EN, LT, RU; docs/guide from src/help (empties the _test DB)
```

Ports and names are chosen not to clash with the sibling PPE-next project (5432/5433,
8080, 5173–5175): Postgres 5442, API 8090, Vite 5180 (Administration 5182, reached through
5180 at `/admin/`), e2e 18090/5181 (Administration 5183), compose project
`ppe-next2`, volume `ppe-next2-pgdata`, DB user/databases `ppe2`/`ppe2`/`ppe2_test`. Keep
new ports out of PPE-next's range.

Any psql target can point at another DB: `make migrate DB=ppe2_test`. Tests run with `-p 1`
because Postgres tests truncate tables.

## Deployment

`docker-compose.prod.yml` (project `ppe-next2-prod`, env file `.env.prod` from
`.env.prod.example`) runs db → migrate (`deploy/migrate.sh`, must match `make migrate`)
→ api (scratch image, `Dockerfile`, tzdata embedded) → caddy (`web/Dockerfile` bakes both
built apps into the Caddy image, the staff app at `WEB_ROOT` served at `/` and
Administration at `ADMIN_ROOT` served at `/admin/`; `deploy/Caddyfile`). Only Caddy publishes ports.
Caddy also sends the security headers, including a Content-Security-Policy that allows
`index.html`'s inline theme script, the same in both apps, by its hash
(`web/apps/{workwear,admin}/src/csp.test.ts` keep them in step; rules in `web/AGENTS.md`).
`make prod-build`, `prod-up`, `prod-down`, `prod-ps`, `prod-logs`, `prod-seed-admin`,
`prod-seed-demo`, `prod-backup`, `prod-backups`, `prod-restore`; they run compose under `env -i` so `.env` values cannot leak in.
The `backup` service (dbbackup agent) is built by `deploy/backup.Dockerfile`
(`go install` of dbbackup `DBBACKUP_VERSION`) on `POSTGRES_IMAGE`, the image `db` and
`migrate` also use, so `pg_dump` always matches the server; it backs up to `DBBACKUP_TARGET` (default the `backups`
volume, on the droplet only; `docs/backups.md` sets up a Spaces bucket, encryption,
restore and the major-upgrade steps). The db volume is named by `POSTGRES_VOLUME`
(default `ppe-next2-prod_db-data`, the name compose gave it).
dbbackup is a **private** repository: the `api` and `backup` image builds read it with the
`github_token` build secret, the gitignored file `.github-token` (a fine-grained token,
read-only on remisb/dbbackup) beside `.env.prod`; CI uses the `DBBACKUP_READ_TOKEN` secret.
Locally, Go fetches it over your own git credentials with `GOPRIVATE=github.com/remisb/*`.
The DigitalOcean droplet serves it at `https://workwear.gavort.nl` (an A record in
gavort.nl's Hostinger DNS; the domain's own website stays at Hostinger) from
`/opt/ppe-next2`, a git checkout of this repository with `.env.prod` (chmod 600, never
committed or printed) beside it. Its Caddy also serves data-sync-ui at `sync.gavort.nl`
(`deploy/sites/sync.caddy`, basic auth), and `deploy/sites/legacy.caddy` redirects the
old `admin.`/`sync.<ip>.sslip.io` addresses, keeping the path so confirmation links sent
before the move still work. Deploy a pushed commit on the droplet:

```bash
cd /opt/ppe-next2 && git pull && make prod-build && make prod-up
```

`prod-up` runs migrations before the API starts and then always recreates `api`, `caddy` and `backup`
(about a second of downtime; certificates live in the `caddy-data` volume), because compose
has left either running the previous image after a rebuild. `db` is recreated only when its
config changes. It ends when the API's `GET /ready` answers (database reachable, every
migration the build embeds applied; `internal/db.Migrations`), else it fails with the API's
log. `GET /health` is liveness only. The image's `HEALTHCHECK` runs `/api -healthcheck` (the
binary probes its own `/ready`, as scratch has no curl); Docker shows but never acts on it.
`make prod-build` stamps `git describe` into the binary (`API_COMMIT` → `-X main.commit`),
shown by `/ready` and `make prod-ready`. Every prod service rotates its logs (`x-logging`, 5 × 10 MB).
The external uptime check of `https://<site>/ready` and DigitalOcean's CPU/memory/disk alerts
are account settings, described in `docs/monitoring.md`.

Accounts need a password, so the first admin is created by a person: set
`API_SEED_USER_EMAIL`/`_PASSWORD` in `.env.prod`, run `make prod-seed-admin`, then blank
the password line. `make prod-seed-demo` needs only the email and refuses a non-empty database.

## Source-of-truth docs

- `docs/architecture/` — the context map (bounded contexts and their dependencies) and the
  ADRs; ADR 0001 (proposed) plans HR and projects/timesheets as contexts in this binary.
- `docs/domain-service-contract.md` — binding rules for every Go domain service. Read it
  before touching `internal/domain/` or `cmd/api/`.
- `docs/specs/<name>-service.md` — per-service requirements (`user-service.md` and
  `session-service.md` cover sign-in).
- `docs/backups.md` — running the backup agent, restoring, and upgrading Postgres.
- `docs/monitoring.md` — `/health`, `/ready`, the healthcheck, log rotation, the external
  uptime check and droplet alerts, and what to look at when one fires.
- `docs/admin/audit-analytics-monitoring.md` (and `.html`) — the proposal for Administration's
  audit log, security, usage analytics and monitoring, in phases (phase 0 is built).
- `docs/ubiquitous-language.md` — the project's terms and UI element names (EN/LT/RU), and the
  words to avoid; add a term there before using it.
- `web/AGENTS.md` — binding rules for frontend apps.
- `../PPE-documents/Workwear_Equipment_App_Developer_Logic_Manual.docx` — the product
  contract (ORDERED/GIVEN orders, immutable line snapshots, bilingual receipts).

## Backend (Go) architecture

- **No web framework**: stdlib `net/http` `ServeMux` with method patterns. Middleware is
  `github.com/remisb/muxstack/middleware`: global `Recoverer`, `Logger`, optional `CORS`,
  `Timeout` in `routes()`. Routes are registered through `router` (`cmd/api/router.go`):
  `rt.public`, `rt.authenticated` (any signed-in user) or `rt.restricted(pattern, h,
  role.CatalogueManage)`, which apply muxstack `Authenticator`/`Authorizer` and record the rule.
  A route requires one **permission** from the catalogue in `internal/domain/role`
  (`permission.go`); roles are bundles of permissions (built-ins in `builtin.go`), and the
  token's `perms` claim carries what the user's roles allow.
  Handlers get the actor with `actorID(r)` (`cmd/api/auth.go`).
- **Composition**: `buildRouter()` in `cmd/api/main.go` mounts every
  `register<Name>Routes(rt, svc)`; `run()` builds the `services` struct.
- **Client address**: the global muxstack `ClientIP` middleware resolves the client,
  believing `X-Forwarded-For` only from `API_TRUSTED_PROXIES`; rate limits key on
  `middleware.ClientAddr`. Never key on `RemoteAddr` or the raw header directly.
- **Config**: every setting must be read in `loadConfig` *and* checked in `validate`;
  `TestLoadConfigDefaults` loads the real defaults to catch a field that is never read.
- **Adding a route** requires an entry in the `policy` table in `cmd/api/routes_test.go`
  (`TestRoutePolicy` fails for unlisted routes and checks 401/403 per permission and per
  built-in role; `TestSeededRolesKeepPolicy` keeps the built-ins' access), and any new
  domain sentinel errors in `errorStatuses` (`cmd/api/http.go`).
- **Audited updates**: repositories take a `Mutation func(cur T) (T, []audit.Event, error)`;
  they lock the row `FOR UPDATE`, call it, then write the row and its events in one
  transaction. Services own the mutation and decide which events (one per kind of change,
  none when nothing changed) to record. `audit.Insert` also records the request's ID, sign-in
  and app (`source`) from the context `requestContext` (`cmd/api/request.go`) set; domains never
  read it. A new event name goes into `audit.Events()` and `AUDIT_EVENTS` (`@ppe/api-client`),
  which tests keep in step with the domains' constants (spec `docs/specs/audit-service.md`).
- **Layout per domain** `internal/domain/<name>/`: `<name>.go` (entity + `CreateParams`/
  `UpdateParams` with `Normalize()`/`Validate()`), `errors.go`, `repository.go`
  (interface), `service.go`, `postgres.go` (pgx). `internal/domain/user` is the reference.
- **Domain never imports `net/http`**. Interfaces are declared by the consumer; assert with
  `var _ Repository = (*PostgresRepository)(nil)`.
- **Service owns policy** (validation, UUIDs, timestamps via `WithClock`/`WithIDGenerator`);
  **repository is dumb** except translating storage errors to sentinels
  (`pgx.ErrNoRows`→`ErrNotFound`, `23505`→conflict, `23503` on actor FK→`ErrActorNotFound`).
- **Errors**: `fieldError(field, problem)` wraps `ErrInvalid`. `writeError` in
  `cmd/api/http.go` is the only place mapping errors to status codes (new domains add cases
  there); unknown errors → logged, opaque 500. JSON errors are `{"error": "..."}`.
- **Actor attribution**: user ID comes from the JWT `sub`, passed explicitly
  (`Create(ctx, params, actorID)`); `uuid.Nil` is `ErrInvalid`. Request structs use
  `decodeJSON` (`DisallowUnknownFields`), so `id`, timestamps and actor fields are rejected.
- **Soft delete everywhere**; reads filter `deleted_at IS NULL`; writes return `ErrNotFound`
  when `RowsAffected()==0`. Uniqueness via partial index on `lower(col) WHERE deleted_at IS NULL`.
- **Aggregates / derived state / HTTP shapes**: see the contract (parent-only entry, one
  repo per aggregate, derive under a row lock; `List` returns `[]` not null; lookups and
  filters are path segments like `/by-email/{email}`).

## Testing

`docs/testing.md` is the map from manual rules to tests; update it when adding a rule.

### Go

- `service_test.go`: table-driven against an in-memory fake repository — no DB; use
  `WithHasher` to skip bcrypt.
- `postgres_test.go`: real Postgres via `API_TEST_DB_DSN`, `t.Skip` when unset, truncates first.
- `cmd/api/routes_test.go` pins the access policy of every route (stub repos; no DB).
  `cmd/api/api_postgres_test.go` runs HTTP flows against the real repositories.
- Postgres tests in different packages share one database and truncate it, so always run
  them with `-p 1` (as `make test`/`make test-db` do).
- The Makefile exports `.env`, so tests that need a var unset must `t.Setenv(key, "")`.
- CI has no compose service: it runs `make migrate PSQL='psql -d <dsn> ...'`, overriding the
  in-container psql the Makefile uses locally.

### End-to-end (`web/e2e`)

One serial spec drives the whole lifecycle through the real UI, API and a `*_test`
database (global setup truncates it and seeds a test admin via `api -seed-admin`). Run
`pnpm exec playwright install chromium` once. Do not run it while `make test-db` runs.
The web server is Vite by default. With `E2E_WEB_SERVER=caddy` (which CI uses), it serves
the `pnpm build` output through `deploy/Caddyfile`, the production proxy config. That mode
needs `caddy` on your `PATH`. CI pins the Caddy version and its SHA-512 checksum in
`ci.yml`, so a Caddy upgrade must update both.
The Vite web servers are started from `apps/<app>/node_modules/.bin/vite`, not `pnpm exec`:
pnpm 12 detaches the child, so Playwright could not stop it and the run hung after the last test.
With Vite, Administration runs on 5183 and the staff app's server proxies `/admin` to it, so
tests open it at `webURL/admin/` on one origin, as behind Caddy.

## Frontend (`web/`)

pnpm workspace (pnpm 12, Node ≥ 22), React 19, TypeScript 7, Vite 8, Vitest 5, Tailwind 4,
shadcn/ui on Base UI. Follow `web/AGENTS.md`.

```bash
cd web && pnpm install
pnpm typecheck && pnpm test && pnpm build           # whole workspace
pnpm --dir apps/workwear dev                         # http://localhost:5180, proxies /api and /admin
pnpm --dir apps/admin dev                            # Administration on 5182; open it at http://localhost:5180/admin/
pnpm --dir apps/workwear exec vitest run src/lib/working-order.test.ts   # one test file
```

The dev server proxies `/api` to `VITE_API_TARGET` (default `http://localhost:8090`; set it
in `apps/workwear/.env.local` when 8090 is taken) and `/admin` to `VITE_ADMIN_TARGET`
(default `http://localhost:5182`). `.claude/launch.json` has `api` (port 8090), `workwear`
(port 5180) and `admin` (port 5182) configs.

- `packages/api-client` is a **hand-written** typed client (`types.ts` mirrors the Go JSON);
  update it with every API change. Its `permissions.ts` lists the permission catalogue in
  Go's order (a Go test compares them). `packages/routing` holds where each app is mounted.
- Shared code is in packages, never copied into an app: `@ppe/ui` (shadcn components,
  `styles.css` tokens and variants, panels, relative dates), `@ppe/app-shell` (sign-in,
  session with `can(permission)`, Sign in, Confirm your password, theme, density, password
  rules, the router), `@ppe/i18n` (language machinery; packages keep small dictionaries of
  their own), `@ppe/backups`, `@ppe/audit` (how recorded changes read: actions, changed
  fields, the Changes section). A screen shows controls by `session.can(...)`, never by role.
  A package with components of its own is named with `@source` in each app's `index.css`:
  Tailwind scans only the app's files and `@ppe/ui`, so its classes would be missing.
- `apps/workwear/src/lib/working-order.ts` holds all Create Order rules as pure, tested
  functions (merge by item, manual-size conflicts on employee change, Save as Employee
  Default, validation, the draft kept per user in localStorage). Screens in `src/routes/` only wire events.
- Imports inside packages use explicit `.ts` extensions (`allowImportingTsExtensions`).
- Both apps are in English, Lithuanian and Russian (each user's choice, `users.language`,
  migration 0016): every visible word comes from `t` in the app's `src/i18n` (typed dictionaries per
  language and namespace; never read `t` at module level). The confirmation page, hand-over
  mode and the Items Given Record stay English / Russian. Rules in `web/AGENTS.md`.
- The user guide is the Help screen (`/help`): typed text in `src/help/{en,lt,ru}.ts`, each
  part limited to the roles that can do it and, where screens differ, to a phone, tablet or
  desktop, with that device's screenshots; `pnpm guide` writes `docs/guide` from it.
- **Do not update the user documentation as part of a change** (the Help text in
  `src/help/*.ts`, its screenshots in `public/help-img`, `docs/guide`, `pnpm guide`):
  the user asks for those updates separately. When a change leaves them out of date, say
  so in one line. Developer docs (`docs/testing.md`, `docs/specs/`, `web/AGENTS.md`, this
  file) are still updated with the change.
- Mobile first; the responsive rules (one Main nav reshaped per breakpoint, `<Table stack>`
  with the screen-only `stacked:` container-query variant, 44px touch targets) are in
  `web/AGENTS.md`. The e2e step "phone and tablet: no screen scrolls sideways" fails if
  any screen or table scrolls sideways at 375, 768, 920, 1100 or 1280px.
