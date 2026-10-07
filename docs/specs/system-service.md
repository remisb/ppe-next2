# System service

How the API watches itself, and the two screens that show it in Administration. This is
phase 3 of [admin/audit-analytics-monitoring.md](../admin/audit-analytics-monitoring.md)
(section 5.2). The deployment's own checks (`/ready`, the healthcheck, log rotation, the
uptime monitor) are in [monitoring.md](../monitoring.md).

- **Overview** (the root of Administration, any Administration permission) shows what
  needs attention, then figures.
- **System** (`system.read`) shows the API, its requests, the database and the error list.
  Backups are its third tab (`backups.read`).

## Request references

- Every request gets an ID (`requestContext`, phase 1), returned as `X-Request-ID`.
- `requestIDHandler` adds it as `request_id` to every log line written with the request's
  context: the request line, `request failed`, `panic recovered`.
- A 500 answers `{"error":"internal error","reference":"<request id>"}`.
- The apps show a server error as "The server could not do this… Reference: 9f2c1a7e", the
  ID's first 8 characters, in the user's language (`errorText`, `ApiError.reference`).
- An administrator finds the request with `make prod-logs | grep 9f2c1a7e`, or on System's
  error list.

## What is observed

`observe` (`cmd/api/observe.go`) wraps every request inside the logger:

- **The route pattern.** `router` registers each handler wrapped by `named`, which notes
  its pattern before anything else runs, so a request that times out or panics is still
  counted under its route. Requests no route matched count as `unmatched`.
- **Metrics:** request count and latency by route (`internal/monitor.Metrics`).
- **The 24-hour window** (`monitor.Window`):
  - 5-minute buckets of requests, 5xx answers and a latency histogram, in total and per
    route.
  - Kept in memory, so it starts again when the API restarts.
  - `/health` and `/ready` are left out, as Docker and the uptime check poll them.
- **5xx answers go on the error list** (below). Why it failed comes from `writeError`
  (`failed`) or `capturePanics`; otherwise it is the status's name, or "request timed out"
  for the Timeout middleware's 503.
- **A request the client abandoned** (a closed tab, a cancelled fetch) is not an error. The
  Timeout middleware answers 503 to a client that has gone. `observe` counts that request
  as 499 and records nothing, and `writeError` does not log a cancelled context as a
  failure.

**Panics.** `capturePanics` sits inside muxstack's `Timeout`, because `Timeout` runs the
handler on a goroutine of its own. A panic there would have stopped the whole API, since
the outer `Recoverer` cannot reach that goroutine. A panic now:
- is answered 500 with a reference;
- is logged with its stack;
- goes on the error list with that stack.

## The error list (`error_events`, migration 0025)

| Column | Notes |
| --- | --- |
| `fingerprint` | 16 hex characters of SHA-256 over the kind, route, method and message with ids and numbers replaced. A panic adds the first function of this module on its stack; a browser error adds its stack's first line |
| `kind` | `server` (a 5xx), `panic`, or `client` (reported by an app) |
| `route`, `method`, `status` | The route pattern, or for a client error the page's path with its ids replaced (`system.ClientRoute`) |
| `message`, `stack` | The latest occurrence's, cut to 1,000 and 8,000 bytes |
| `first_seen`, `last_seen`, `count` | An occurrence within an hour (`FoldWithin`) of a row's last one with the same fingerprint is counted on that row |
| `last_request_id`, `last_user_id`, `last_user_agent`, `source` | The latest occurrence's request: the reference, the signed-in user, the browser and the app |

- Rows not seen for 30 days (`system.Retention`) are deleted by the API's hourly upkeep.
- The table is an operational record, not the audit trail: folding updates rows.
- `TRUNCATE users CASCADE` empties it (FK `last_user_id`).

**Client errors.** `@ppe/app-shell` (`reportErrors`, while someone is signed in) sends the
page's uncaught errors and unhandled rejections to `POST /api/v1/client-errors`:
- each message once, at most 10 a page load;
- it leaves out browser extensions' errors, cross-origin "Script error." and cancelled
  requests;
- the API allows 20 a minute per client address.

The request is same-origin, so the Content-Security-Policy is unchanged. Errors thrown
before the sign-in is known are not reported.

## The database

`system.Service.Database` reads:
- Postgres's version and the database's size;
- the 8 largest tables, with indexes and Postgres's row estimate;
- connections by state against `max_connections`;
- the oldest open transaction other than its own;
- the latest applied migration.

The API's pool (in use, idle, the limit, waits) comes from `pgxpool`.

The hourly upkeep records the database's size once a day in `db_size_samples`. Growth
compares the size now with the newest sample at least 30 days old (`GrowthSpan`), or the
oldest kept.

## Upkeep (`cmd/api/jobs.go`)

At start and hourly, until ADR 0001's worker exists, the upkeep:
- purges security events older than `API_AUTH_EVENTS_RETENTION`, under an advisory lock;
- deletes error-list rows not seen for 30 days;
- records today's database size.

What it deleted and when are shown on System, and a part that failed is logged: `security
events purge failed`, `error list purge failed`, `database size sample failed`.

## Metrics

Prometheus's text format at `/metrics` on a second listener, `API_METRICS_ADDR` (empty:
none). Production sets `:9090`, on the compose network only: no port is published and Caddy
never proxies it. Read it during an incident with:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec caddy wget -qO- http://api:9090/metrics
```

| Metric | Labels |
| --- | --- |
| `ppe_http_requests_total` | `route`, `method`, `status` (499: the client went away) |
| `ppe_http_request_duration_seconds` | `route` (histogram) |
| `ppe_sign_in_failures_total` | `reason` (`bad_password`, `unknown_email`, `inactive`, `too_many_attempts`) |
| `ppe_error_events_total` | `kind` |
| `ppe_db_pool_connections`, `ppe_db_pool_max_connections`, `ppe_db_pool_waits_total`, `ppe_db_pool_wait_seconds_total` | `state` for the first |
| Go runtime and process | the client library's collectors |

Nothing scrapes them yet. A monitoring stack (proposal 5.3) would.

## The Overview's attention items (`internal/overview`)

The rules are pure and tested. `GET /api/v1/overview` (any signed-in user) gathers only the
areas the token's permissions open, so the employee role gets an empty Overview.

| Item | Severity | Rule | Needs |
| --- | --- | --- | --- |
| `backups_not_running` | critical | no recent successful backup, or the agent is offline | `backups.read` |
| `last_backup_failed` | warning | the newest run failed (backups otherwise recent) | `backups.read` |
| `copied_sign_in` | critical | any `refresh_reused` in 7 days | `security.read` |
| `failed_sign_ins` | warning | over 20 failed sign-ins or confirmations in the last hour, or over 5 at one email | `security.read` |
| `review_overdue` | warning | access never reviewed, or not for 90 days | `security.read` |
| `error_rate` | warning | at least 1 % of the last hour's requests failed, with at least 50 requests | `system.read` |
| `new_errors` | warning | an error fingerprint first seen in the last day | `system.read` |
| `database_growth` | info | over 20 % growth since the comparison sample, at least 7 days old | `system.read` |

The figures cover the same areas:
- active and inactive users (`users.read`);
- people and devices signed in now, and sign-ins and failures today in the organisation's
  timezone (`security.read`);
- the last 24 hours' requests and failures, and the database's size (`system.read`);
- the last backup (`backups.read`).

The keys are in `overview.Keys()` and `ATTENTION_KEYS` (`@ppe/api-client`), compared by
`TestWebClientListsTheKeys`.

## API

| Route | Permission | Notes |
| --- | --- | --- |
| `GET /api/v1/overview` | any signed-in user | areas by the token's permissions |
| `GET /api/v1/system/status` | `system.read` | service (commit, Go, started, ready), the window, database and pool, retention and the last upkeep |
| `GET /api/v1/system/errors?kind=&after=&page_size=` | `system.read` | last seen first, keyset pages with the Audit log's cursor; unknown or repeated parameters are 400 |
| `GET /api/v1/system/errors/{id}` | `system.read` | one row, 404 when there is none |
| `POST /api/v1/client-errors` | any signed-in user | `{message, stack, path}`, unknown fields 400; 204 |

## Screens

**Overview** (`/admin/`, `web/apps/admin/src/routes/overview.tsx`):
- The attention items, worst first, each with Open … to where it is put right. These are
  Backups, Sign-ins filtered to that event, Errors, the Access review and System.
- Then the figures.

**System** (`/admin/system`, `routes/system.tsx`) has three tabs:
- **Status:**
  - Ready or not, the version, when the API started, and the Go version.
  - Requests, which is the 24 hours as hourly bars with failures in red, the typical and
    slowest-5 % times, and the slowest routes.
  - The database: size and growth, Postgres version, connections, the API's pool, the
    oldest transaction, the latest migration and the largest tables.
  - How long records are kept, and the last cleanup.
- **Errors** (`/system/errors`, one open at `/system/errors/<id>` beside the list from `lg`):
  - a filter by kind;
  - each error's latest message, route, count and when it was last seen;
  - open, it shows first and last seen, who, the app, the device, the reference and the
    stack.
- **Backups** (`/system/backups`; `/admin/backups` leads there) is the former Backups
  screen.

On a phone, Roles & permissions, System and Settings are under More.
