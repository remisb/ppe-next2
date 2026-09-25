# Workwear & Equipment App

An internal tool for ordering workwear, PPE and equipment for one employee at a time, then
recording that the employee received it.

1. **Create Order.** Pick the employee (*Assigned to*). Add items one by one or apply an
   *Item Set*. Sizes are filled in from the employee's saved sizes, and clothing sizes can
   be suggested from height.
2. **Mark as Ordered.** The order becomes an immutable `ORDERED` record. Each line stores a
   snapshot of the item, size, quantity, price (EUR) and service period. Later changes to
   the catalogue or to employee sizes never change existing orders. *Copy for WhatsApp*
   formats the order for the supplier.
3. **Confirm receipt.** The employee confirms through a one-time link (*Open Employee
   Confirmation*) or on a signed paper record. Either way the same record becomes `GIVEN`,
   with a locked receipt in English and Russian that can be printed on A4.
4. **History** lists every record, newest first. It filters by employee, date and status,
   and shows usage time for items already given.

The product rules come from the *Workwear & Equipment App — Developer Logic Manual*
(`../PPE-documents/`). [docs/testing.md](docs/testing.md) maps each rule to the tests that
cover it.

## Stack

| Part | Technology |
|---|---|
| API | Go 1.27 with stdlib `net/http` (no framework) and [muxstack](https://github.com/remisb/muxstack) middleware; JWT (HS256) auth with bcrypt passwords |
| Database | PostgreSQL 18; plain SQL migrations in `internal/db/migrations` |
| Web | pnpm workspace in `web/`: React 19, TypeScript 7, Vite 8, Tailwind 4 and shadcn/ui |
| Tests | Go unit tests plus Postgres tests, Vitest, and Playwright end-to-end tests |
| CI | GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) |

### Roles

| Role | Can do |
|---|---|
| `employee` | Staff who prepare orders: employees and sizes, Create Order, History, confirmation links, paper confirmation |
| `manager` | Everything above, plus the Item Catalogue (items and prices) and Item Sets |
| `admin` | Everything, including user management |

The public confirmation page needs no sign-in. The token in its link is the only
authorisation.

## Repository layout

```
cmd/api/                 HTTP server: config, routes, auth, error mapping
internal/domain/<name>/  domain services (user, employee, catalogue, itemset, order, size)
internal/audit/          append-only audit events
internal/db/migrations/  NNNN_name.up.sql / .down.sql
docs/                    domain-service contract, per-service specs, test map
web/apps/workwear/       the web app
web/packages/            api-client (typed, hand-written) and routing
web/e2e/                 Playwright suite
```

## Prerequisites

- Go 1.27.1+ (the version in `go.mod`)
- Docker with Compose (for local Postgres)
- Node.js 22+ and pnpm 11 (`corepack enable` picks up the pinned version)
- `make`

## Getting started

PPE-next2 uses its own ports so that it can run alongside the sibling PPE-next project
without either one reaching the other's services:

| Service | Port |
|---|---|
| Postgres | 5442 |
| API | 8090 |
| Web dev server | 5180 |
| End-to-end tests | 18090 (API) and 5181 (web) |

The Docker names are also separate: the compose project is `ppe-next2` and the data
volume is `ppe-next2-pgdata`. The database user and names are `ppe2`, `ppe2` and
`ppe2_test`.

```bash
cp .env.example .env
```

Edit `.env` and set at least `API_JWT_SECRET`, which must be 32 bytes or more. You can
generate one with `openssl rand -base64 48`.

```bash
make db-up
```

```bash
make migrate
```

```bash
make seed-admin
```

`make seed-admin` creates the first admin from `API_SEED_USER_*`. Change that password
after signing in, on the **Account** page.

Start the API:

```bash
make run
```

The API listens on port 8090. If that port is taken, run `make run API_ADDR=:8091` and
create `web/apps/workwear/.env.local` containing `VITE_API_TARGET=http://localhost:8091`.

In a second terminal, install the web dependencies and start the web app:

```bash
cd web && pnpm install
```

```bash
pnpm --dir web/apps/workwear dev
```

Open http://localhost:5180 and sign in with the seeded admin. The Vite dev server proxies
`/api` to the Go API, so no CORS setup is needed.

`make help` lists every Make target.

## Testing

### Go

```bash
make vet
```

```bash
make test
```

`make test` runs the unit tests only; tests that need Postgres are skipped. To run the
Postgres tests too, create the separate test database once (named `<POSTGRES_DB>_test`)
and then run the full suite:

```bash
make db-test-create
```

```bash
make test-db
```

The Postgres tests truncate tables. `make test-db` refuses to run if `API_TEST_DB_DSN`
equals `API_DB_DSN`. Tests always run with `-p 1`.

### Web

```bash
cd web && pnpm typecheck && pnpm test && pnpm build
```

### End-to-end

One serial Playwright spec drives the whole order lifecycle through the real UI, the API
and the `_test` database. The setup empties that database first. The suite starts its own
API on port 18090 and Vite on port 5181.

To test the production setup instead, build the bundle with `pnpm build` and run with
`E2E_WEB_SERVER=caddy`. The suite then serves the build through `deploy/Caddyfile` on port
5181, as CI does. This needs `caddy` on your `PATH`.

```bash
cd web/e2e && pnpm exec playwright install chromium
```

```bash
make e2e
```

Do not run `make e2e` and `make test-db` at the same time, because both use the test
database.

### CI

Every push to `main` and every pull request runs three jobs on `ubuntu-24.04`:
- **Go**: vet, plus tests against a Postgres 18 service.
- **Web**: typecheck, test and build.
- **End-to-end**:
  1. Installs a pinned, checksum-verified Caddy.
  2. Checks that `deploy/Caddyfile` is formatted and valid.
  3. Builds the web bundle.
  4. Runs the Playwright suite against it, served through Caddy.

  The report is uploaded when the job fails.

There is no CD job yet: deployment is manual (see below).

## Configuration

The API reads environment variables, and `.env` is exported by the Makefile. Only
`-addr` and `-seed-admin` are also available as flags. Secrets have no flags.

| Variable | Default | Notes |
|---|---|---|
| `API_ADDR` | `:8090` | Listen address |
| `API_DB_DSN` | — | **Required.** Postgres connection string |
| `API_DB_MAX_CONNS` | `10` | Pool size |
| `API_JWT_SECRET` | — | **Required**, at least 32 bytes |
| `API_JWT_ISSUER` | `ppe-next2` | |
| `API_JWT_TTL` | `15m` | Between 1m and 24h |
| `API_LOGIN_RATE_LIMIT` / `API_LOGIN_RATE_INTERVAL` | `5` / `1m` | Login attempts per IP |
| `API_REQUEST_TIMEOUT` / `API_SHUTDOWN_TIMEOUT` | `10s` / `10s` | |
| `API_ALLOWED_ORIGINS` | empty | Comma-separated CORS origins. Leave empty when the web app is served from the same origin |
| `API_ORG_TIMEZONE` | `Europe/Vilnius` | History date filters and usage time count days in this zone. Timestamps are stored in UTC |
| `API_PUBLIC_BASE_URL` | `http://localhost:5180` | Where the web app is served. Confirmation links are `<this>/confirm/<token>` |
| `API_CONFIRM_TTL` | `168h` | How long a confirmation link stays valid (1m–2160h) |
| `API_SEED_USER_EMAIL` / `_PASSWORD` / `_NAME` | — / — / `Administrator` | Used only by `-seed-admin` |
| `API_TEST_DB_DSN` | — | Test database for the Postgres tests. It must differ from `API_DB_DSN` |

The API checks every setting at startup and exits with a list of problems if any are
invalid.

## Building and deploying

There is no Dockerfile or deployment pipeline yet. A deployment has three parts:
Postgres, the API binary, and the static web build behind one reverse proxy.

1. **Database.** Provision PostgreSQL 18. Apply the migrations with the same Make target,
   pointing psql at the server:

   ```bash
   make migrate PSQL='psql -d postgres://user:pass@host:5432/ppe2 -v ON_ERROR_STOP=1 -q'
   ```

   Each migration runs in its own transaction and is recorded in `schema_migrations`, so
   re-running only applies new files.

2. **API.** Build a static binary. For a Linux server, cross-compile it:

   ```bash
   CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o api ./cmd/api
   ```

   Run it as a service (for example with systemd) with the environment variables above.
   In production, use a random `API_JWT_SECRET` and set `API_PUBLIC_BASE_URL` to the
   public URL of the web app. Create the first admin once with `./api -seed-admin`, then
   remove the `API_SEED_USER_*` variables. `GET /health` returns 200 once the API is
   serving, which you can use for the proxy or orchestrator health check. The API shuts
   down gracefully on SIGINT or SIGTERM.

3. **Web app.** Build the static bundle:

   ```bash
   cd web && pnpm install --frozen-lockfile && pnpm build
   ```

   Serve `web/apps/workwear/dist/` from the same origin as the API:
   - Proxy `/api/` and `/health` to the API.
   - Serve every other path from `dist/`, falling back to `index.html` for client-side
     routes such as `/history` and `/confirm/<token>`.

   To serve the app under a sub-path, build it with Vite's `--base`, for example
   `pnpm --dir apps/workwear exec vite build --base /workwear/`. The router picks up the
   base path automatically.

   [deploy/Caddyfile](deploy/Caddyfile) is the [Caddy](https://caddyserver.com)
   configuration that does this. It is the same file the CI end-to-end job runs against, so
   CI tests it on every push. Three environment variables adjust it:

   | Variable | Default | Notes |
   |---|---|---|
   | `SITE_ADDRESS` | `localhost` | The public domain, such as `workwear.example.com`. Use `http://host:port` for plain HTTP |
   | `API_UPSTREAM` | `127.0.0.1:8090` | Where the API listens |
   | `WEB_ROOT` | `/srv/workwear/dist` | Where the web build is copied |

   Copy it to `/etc/caddy/Caddyfile`, and set the variables for the Caddy service (for
   example in a systemd drop-in with `Environment=SITE_ADDRESS=workwear.example.com`).
   Then reload Caddy:

   ```bash
   sudo systemctl reload caddy
   ```

   Set `API_PUBLIC_BASE_URL=https://workwear.example.com` so that confirmation links point
   at the site.

Caddy gets and renews a TLS certificate automatically when the site address is a public
domain. The domain's DNS must point at the server, and ports 80 and 443 must be open.
Confirmation links carry a bearer token, and the page sets a `no-referrer` policy, but the
links should still only be served over HTTPS.

**Backups:** the order records, confirmation evidence and audit trail exist only in
Postgres. Back up the database, for example with `pg_dump` on a schedule.

## Further reading

- [CLAUDE.md](CLAUDE.md): architecture notes and conventions for contributors
- [docs/domain-service-contract.md](docs/domain-service-contract.md): rules every Go
  domain service follows
- [docs/specs/](docs/specs/): per-service requirements
- [docs/testing.md](docs/testing.md): which tests cover which manual rules
- [web/AGENTS.md](web/AGENTS.md): frontend rules
