# PPE-next2 architecture checklist

Each item names the rule's source. Apply a section only when its area changed.

## Boundaries and layering
- No `internal/domain` package imports another, except the judged pairs in
  `scripts/fitness.sh`. Cross-domain reads go through an interface the consumer declares,
  adapted in `cmd/api/checkers.go`. (domain-service-contract.md, Layering; context-map.md)
- Domain packages never import `net/http` or other transport. (contract, Layering)
- Foreign keys cross a context only into employees (shared kernel) and users (actors);
  other references are UUIDs checked through the upstream's interface, snapshotted where a
  record must not change. (context-map.md, Rules)
- Nothing reads Personnel files' data but Personnel files. (context-map.md)

## Domain services
- Five-file layout; `Normalize()`/`Validate()` on params; sentinel errors; `fieldError`.
- Service owns validation, IDs and time (`WithClock`, microsecond truncation); the
  repository only translates storage errors. (contract, Layering and Construction)
- Audited writes use the `Mutation` pattern; one event per kind of change, none when
  nothing changed; new event names in `audit.Events()` and `AUDIT_EVENTS`.
  (CLAUDE.md, Audited updates; audit-service.md)
- Soft delete: reads filter `deleted_at IS NULL`; every query over `orders` too, the
  dashboards' included, with a seeded deleted order in the Postgres test.
- `List` returns `[]`, not null; lookups are path segments. (contract, Input and output shapes)

## HTTP and access
- A new route has a `policy` entry in `cmd/api/routes_test.go` and requires one permission
  from `internal/domain/role/permission.go`; a new permission is also in
  `web/packages/api-client/src/permissions.ts`, same order. (ADR 0002)
- New sentinel errors map in `errorStatuses` / `writeError` only. (cmd/api/http.go)
- Request bodies via `decodeJSON`; no `id`, timestamps or actor fields accepted.
- Client address from `middleware.ClientAddr`, never `RemoteAddr`.
- A new setting is read in `loadConfig` and checked in `validate`.
- `@ppe/api-client` types updated with the API change.

## Data and database
- Migration has up and down, the next number, and is applied by both `make migrate` and
  `deploy/migrate.sh`.
- A new append-only table: UPDATE/DELETE trigger, TRUNCATE guard (`ppe.allow_truncate`),
  on `grants.sql`'s REVOKE line, and tests that set the flag. (CLAUDE.md, invariants)
- Anything `ppe_app` needs beyond DML on new tables changes `internal/db/grants.sql`;
  `TestPostgresAPIRoleIsLeastPrivileged` still holds.
- Snapshots and document hashes never change shape for existing rows (order lines,
  assignment forms; `unit_price_cents`). (manual; ADR 0004 item 5)
- Personal data: the minimum collected; HR rules of ADR 0001 for sensitive data.

## Security
- Secrets stay out of the database and its backups (`API_SIM_CODES_KEY`, ADR 0005).
- Reads of sealed or sensitive values need a permission, a recent sign-in and an audit
  event (as Show PIN and PUK).
- Files: type read from bytes, size limit, served as attachment through the API. (ADR 0004)
- CSP: the inline script hash is the same in every app, `csp.test.ts` updated;
  `/sim-scan/` alone gets its extra sources. (web/AGENTS.md, Content-Security-Policy)

## Frontend
- Shared code in `web/packages`, never copied into an app; a package with components is
  named with `@source` in each app's `index.css`.
- Controls shown by `session.can(...)`, never by role.
- Every visible word through `t`, in EN, LT and RU.
- Mobile first; no sideways scroll at the widths the e2e step checks.
- A new app touches the places ADR 0006 lists; prefer a module of the staff app (ADR 0001).

## Operations
- Compose and Caddy changes keep `make prod-up`'s guarantees (migrate before API, `/ready`).
- A new background job is safe with a second API instance (advisory lock).
- New ports stay out of PPE-next's range.

## Documents and language
- New terms in `docs/ubiquitous-language.md` before use; no word from Words to avoid.
- Spec, `docs/testing.md`, `web/AGENTS.md` and `CLAUDE.md` updated with the change; the
  Help guide is not (say it is out of date in one line).
- A structural choice has an ADR; an accepted ADR is superseded, never edited.
