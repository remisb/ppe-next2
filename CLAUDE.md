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
`web/apps/workwear` app (Create Order, Employees, Item Catalogue, Item Sets) — and
Slice 4: Mark as Ordered (`POST /api/v1/orders`, snapshot copy in one transaction) and
Copy for WhatsApp — and Slice 5: History (`GET /api/v1/orders`, query-parameter filters
in the organisation timezone `API_ORG_TIMEZONE`, server-computed `usage_months`).
— and Slice 6: confirmation links (hashed tokens, sent in request bodies), paper
confirmation, idempotent ORDERED → GIVEN, and the locked bilingual receipt with document
hash and A4 print (`order/confirmation.go`, `order/receipt.go`, `web/.../routes/confirm.tsx`).
The public `/confirm/<token>` page renders before the sign-in gate. Slice 7 added the
Playwright e2e suite (`web/e2e`), CI (`.github/workflows/ci.yml`) and `docs/testing.md`,
which maps every manual §7 rule and status transition to its tests.

Database-enforced invariants worth knowing: `audit_events` and `order_lines` reject
UPDATE/DELETE via triggers; `orders` allows only `ORDERED`/`GIVEN` and a CHECK ties the
`given_*` columns to the status; catalogue price and service period are nullable (Mark as
Ordered must refuse such items), while order-line snapshots require them. Postgres tests
must `TRUNCATE ... CASCADE` because of the actor foreign keys.

## Commands

Copy `.env.example` to `.env` first; the Makefile and docker compose both read it.

```bash
make db-up            # Postgres 18 in Docker (docker-compose.yml), waits until healthy
make migrate          # apply pending internal/db/migrations/*.up.sql via psql in the container
make migrate-down     # revert all; make migrate-status lists applied files
make seed-admin       # create the first admin from API_SEED_USER_*
make run              # go run ./cmd/api
make vet
make test             # go test -p 1 ./... — Postgres tests skip without API_TEST_DB_DSN
make db-test-create   # create + migrate the <POSTGRES_DB>_test database
make test-db          # all tests incl. Postgres ones (refuses if test DSN == main DSN)
make e2e              # Playwright end-to-end; empties the _test DB, starts API :18090 + Vite :5181
go test ./internal/domain/user -run TestAuthenticate   # single test
cd web/e2e && pnpm exec playwright test -g "paper confirmation"   # one e2e step (suite is serial)
```

Ports and names are chosen not to clash with the sibling PPE-next project (5432/5433,
8080, 5173–5175): Postgres 5442, API 8090, Vite 5180, e2e 18090/5181, compose project
`ppe-next2`, volume `ppe-next2-pgdata`, DB user/databases `ppe2`/`ppe2`/`ppe2_test`. Keep
new ports out of PPE-next's range.

Any psql target can point at another DB: `make migrate DB=ppe2_test`. Tests run with `-p 1`
because Postgres tests truncate tables.

## Source-of-truth docs

- `docs/domain-service-contract.md` — binding rules for every Go domain service. Read it
  before touching `internal/domain/` or `cmd/api/`.
- `docs/specs/<name>-service.md` — per-service requirements (`user-service.md` exists).
- `web/AGENTS.md` — binding rules for frontend apps.
- `../PPE-documents/Workwear_Equipment_App_Developer_Logic_Manual.docx` — the product
  contract (ORDERED/GIVEN orders, immutable line snapshots, bilingual receipts).

## Backend (Go) architecture

- **No web framework**: stdlib `net/http` `ServeMux` with method patterns. Middleware is
  `github.com/remisb/muxstack/middleware`: global `Recoverer`, `Logger`, optional `CORS`,
  `Timeout` in `routes()`. Routes are registered through `router` (`cmd/api/router.go`):
  `rt.public`, `rt.authenticated` (any signed-in user) or `rt.restricted(pattern, h,
  managers...)`, which apply muxstack `Authenticator`/`Authorizer` and record the rule.
  Handlers get the actor with `actorID(r)` (`cmd/api/auth.go`).
- **Composition**: `buildRouter()` in `cmd/api/main.go` mounts every
  `register<Name>Routes(rt, svc)`; `run()` builds the `services` struct.
- **Client address**: rate limits key on `clientAddr.key` (`cmd/api/clientip.go`), which
  believes `X-Forwarded-For` only from `API_TRUSTED_PROXIES`. Never key on `RemoteAddr` or
  the raw header directly.
- **Config**: every setting must be read in `loadConfig` *and* checked in `validate`;
  `TestLoadConfigDefaults` loads the real defaults to catch a field that is never read.
- **Adding a route** requires an entry in the `policy` table in `cmd/api/routes_test.go`
  (`TestRoutePolicy` fails for unlisted routes and checks 401/403 per role), and any new
  domain sentinel errors in `errorStatuses` (`cmd/api/http.go`).
- **Audited updates**: repositories take a `Mutation func(cur T) (T, *audit.Event, error)`;
  they lock the row `FOR UPDATE`, call it, then write the row and the event in one
  transaction. Services own the mutation and decide which event (if any) to record.
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

## Frontend (`web/`)

pnpm workspace (pnpm 11, Node ≥ 22), React 19, TypeScript 7, Vite 8, Vitest 5, Tailwind 4,
shadcn/ui on Base UI. Follow `web/AGENTS.md`.

```bash
cd web && pnpm install
pnpm typecheck && pnpm test && pnpm build           # whole workspace
pnpm --dir apps/workwear dev                         # http://localhost:5180, proxies /api
pnpm --dir apps/workwear exec vitest run src/lib/working-order.test.ts   # one test file
```

The dev server proxies `/api` to `VITE_API_TARGET` (default `http://localhost:8090`; set it
in `apps/workwear/.env.local` when 8090 is taken). `.claude/launch.json` has `api` (port
8090) and `workwear` (port 5180) configs.

- `packages/api-client` is a **hand-written** typed client (`types.ts` mirrors the Go JSON);
  update it with every API change. `packages/routing` holds only the mount base path.
- `apps/workwear/src/lib/working-order.ts` holds all Create Order rules as pure, tested
  functions (merge by item, manual-size conflicts on employee change, Save as Employee
  Default, validation, sessionStorage draft). Screens in `src/routes/` only wire events.
- Imports inside packages use explicit `.ts` extensions (`allowImportingTsExtensions`).
