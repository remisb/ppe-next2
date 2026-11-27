---
paths:
  - "**/*.go"
  - "**/*.sql"
  - "go.mod"
---

# Backend rules (Go, SQL)

Loaded when Claude works on Go or SQL files. The binding rules for domain services are
`docs/domain-service-contract.md`; read it before touching `internal/domain/` or `cmd/api/`.

## Architecture

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
- **Request pipeline** (`routes()`): `Recoverer`, `ClientIP`, `requestContext` (the request
  ID and `audit.Request`), `Logger`, `observe` (metrics, the 24-hour window, 5xx on the error
  list), CORS, `Timeout`, then `capturePanics`, which must stay inside `Timeout`: muxstack
  runs the handler on a goroutine of its own (with its own header map, so the handler never
  shares `w.Header()` with the 503); a panic re-raised to `Recoverer` has lost the handler's
  stack and the JSON 500 with its `reference`. `observe` counts a request whose client went
  away as 499, whatever Timeout wrote. `router` wraps
  every handler in `named`, which tells `observe` the route pattern.
- **Client address**: the global muxstack `ClientIP` middleware resolves the client,
  believing `X-Forwarded-For` only from `API_TRUSTED_PROXIES`; rate limits key on
  `middleware.ClientAddr`. Never key on `RemoteAddr` or the raw header directly.
- **Config**: every setting must be read in `loadConfig` *and* checked in `validate`;
  `TestLoadConfigDefaults` loads the real defaults to catch a field that is never read.
- **Adding a route** requires an entry in the `policy` table in `cmd/api/routes_test.go`
  (`TestRoutePolicy` fails for unlisted routes and checks 401/403 per permission and per
  built-in role; `TestSeededRolesKeepPolicy` keeps the built-ins' access), and any new
  domain sentinel errors, declared with `apperr.New`, in `cmd/api/http_errors_test.go`.
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
- **Service owns policy** (validation, UUIDs, timestamps via `WithClock`);
  **repository is dumb** except translating storage errors to sentinels
  (`pgx.ErrNoRows`→`ErrNotFound`, `23505`→conflict, `23503` on actor FK→`ErrActorNotFound`).
- **Errors**: every answered sentinel is `apperr.New(kind, code, msg)` (`internal/apperr`: still
  matched by `errors.Is` on the sentinel, and on its kind, such as `apperr.Conflict`); `fieldError`
  wraps `ErrInvalid`. `writeError` (`cmd/api/http.go`) alone maps **kinds** to statuses
  (`kindStatuses`; `ErrActorNotFound` is `Unauthenticated`); unknown errors → logged, opaque 500 with the
  request's `reference`, and put on System's error list. JSON errors are `{"error": "...", "code":
  "supplier.code_taken"}` (no code on a 401, which reads "unauthenticated", or a 500).
- **Actor attribution**: user ID comes from the JWT `sub`, passed explicitly
  (`Create(ctx, params, actorID)`); `uuid.Nil` is `ErrInvalid`. Request structs use
  `decodeJSON` (`DisallowUnknownFields`), so `id`, timestamps and actor fields are rejected.
- **Soft delete everywhere**; reads filter `deleted_at IS NULL`; writes return `ErrNotFound`
  when `RowsAffected()==0`. Uniqueness via partial index on `lower(col) WHERE deleted_at IS NULL`.
- **Aggregates / derived state / HTTP shapes**: see the contract (parent-only entry, one
  repo per aggregate, derive under a row lock; `List` returns `[]` not null; lookups and
  filters are path segments like `/by-email/{email}`).


## Database invariants

Database-enforced invariants worth knowing: `audit_events`, `order_lines`, `auth_events`,
`audit_seals`, `audit_seal_stamps` and `audit_purges` reject UPDATE/DELETE via triggers (except the purges, which
go through the owner's `SECURITY DEFINER` functions `purge_audit_events` (rows over 365
days) and `purge_auth_events` (over 30 days)), and the six refuse TRUNCATE unless the
transaction sets `SET LOCAL ppe.allow_truncate = on`, as test setup does; `orders` allows only `ORDERED`/`GIVEN` and a CHECK ties the
`given_*` columns to the status; a catalogue item's accounting price and service period are
nullable (Mark as Ordered must refuse such items), while order-line snapshots require them.
`asset_assignments` allow one open assignment per asset (a partial unique index) and a
trigger refuses deleting one, changing its giving, or setting its Not Returned mark or return
twice; `asset_numbers` keeps every inventory number ever used (`ppe_app` may not change it);
App Launcher's tiles are never deleted (Retired instead), and `TRUNCATE users CASCADE` empties
them through their actor key, so Postgres tests and e2e get the defaults back
(`launcher.EnsureDefaults`, which the API also runs at start-up);
`asset_signed_copies` is append-only (trigger and grants): uploading again adds a row. The
files themselves are in the Spaces bucket, not in the database or its backups
(`docs/backups.md`, "Uploaded files").
An item's size group is its **picture's** (migration 0036, `catalogue_pictures`: one fixed
row per pictogram, ppe_app may only UPDATE it; spec "Pictures" in `catalogue-service.md`):
`catalogue_items` has no `size_group` column, so SQL over items joins the picture for it, and
the e2e setup puts the pictures' size groups back. Order lines keep their own.
An item also has an optional purchase price (migration 0021), snapshotted on order lines
but shown on no order or record. The app labels the accounting price "Price"; the record's
`unit_price_cents` key holds it and never changes, because it is part of the document hash.
Users hold roles only through `user_roles` (no `users.roles` column since 0022); the
built-in roles have fixed ids (`role.AdminID` …), Administrator is never changed or
deleted, and at least one active user always holds it (checked after each user write under
an advisory lock). `TRUNCATE users CASCADE` also empties `roles` (actor keys), so Postgres
tests and e2e setup call `role.EnsureBuiltins` after it (`-seed-admin` does).
A manager may
soft-delete an order (`DELETE /api/v1/orders/{id}`, `orders.delete`, the built-in Manager's, migration 0015), so
every query over `orders`, the dashboards' included, must filter `deleted_at IS NULL`; the
dashboard Postgres tests seed deleted orders to catch one that does not. Postgres tests
in a package share its database (`dbtest.DSN`) and empty it first; they
must `TRUNCATE ... CASCADE` because of the actor foreign keys, after
`SET LOCAL ppe.allow_truncate = on` in the same `Exec`, and must name `audit_seals,
audit_purges` when they empty `audit_events`, and `asset_number_counters` when they need
inventory numbers to start again (no key reaches it).
The API connects as the least-privilege role **`ppe_app`** in production (once
`API_DB_USER`/`API_DB_PASSWORD` are set), in local dev (`.env.example`, with the tests'
password `ppe-app-test`: roles are shared by `ppe2` and `ppe2_test`) and in the API's
Postgres tests and e2e; its grants are `internal/db/grants.sql`, applied after the
migrations on every `make migrate` and `deploy/migrate.sh` run, which also give it its
password when `API_DB_USER=ppe_app`. A new append-only table goes into its REVOKE line, and a
migration that needs ppe_app to do anything beyond DML on new tables changes grants.sql.

