# Domain Service Contract

Rules every domain service in this project follows. `internal/domain/<name>/` is the
reference implementation — when something here is ambiguous, read that package.

Service-specific requirements live in `docs/specs/<name>-service.md`.

## Package layout

`internal/domain/<name>/`, one concern per file:

| File | Holds |
| --- | --- |
| `<name>.go` | entity, `CreateParams`/`UpdateParams` with `Normalize()` + `Validate()` |
| `errors.go` | sentinel errors and the `fieldError` helper |
| `repository.go` | the `Repository` **interface** |
| `service.go` | `Service`, its `Option`s, and the use cases |
| `postgres.go` | `PostgresRepository` implementing the interface |

## Layering

**The domain package never imports `net/http`.** Transport lives in
`cmd/api/<name>-routes.go`. The domain exposes Go types and sentinel errors; the HTTP
layer owns status codes, JSON shapes, and URL parsing. This is what keeps a domain
service reusable behind a different transport.

The rule generalises past HTTP: `net/smtp` in a domain package would be the same mistake,
for the same reason. `internal/mail` is therefore infrastructure rather than a domain
service — it has no entity, no table, and no soft delete, so nothing else in this document
applies to it — and the domain that needs it declares a one-method `Mailer` interface,
which the composition root satisfies. Sending mail from `internal/domain/invitation` is
possible without that package ever learning what SMTP is.

**Interfaces are declared by the consumer.** `Repository` is defined in the domain
package that *uses* it, not beside its Postgres implementation. The domain states what
it needs and storage conforms, so the dependency points inward and tests can substitute
a fake. Assert conformance with `var _ Repository = (*PostgresRepository)(nil)`.

**Service owns policy; repository is dumb persistence.** `Service` does validation, UUID
generation, and timestamps. Repositories only read and write rows — they never validate
or invent values. The single exception: a repository **must** translate storage errors
into the domain's sentinels (`pgx.ErrNoRows` → `ErrNotFound`, SQLSTATE `23505` →
`ErrNameTaken`). Nothing outside `postgres.go` should know what a `pgconn.PgError` is.

## Errors

Each domain exports `ErrNotFound`, `ErrInvalid`, and any domain-specific conflicts
(supplier adds `ErrNameTaken`). Build validation errors with `fieldError(field, problem)`
so they wrap `ErrInvalid` and name the offending input. Wrap with `%w` when adding
context; callers match with `errors.Is`.

`writeError` in the routes file is the *only* place errors become status codes:

| Error | Status |
| --- | --- |
| `ErrNotFound` | 404 |
| `ErrNameTaken` (or other conflict) | 409 |
| `ErrInvalid` | 400 |
| malformed body / bad UUID | 400 |
| anything else | 500, detail logged, opaque body |

Never let a storage error reach the client.

## Construction

`NewService(repo, opts...)` defaults to `time.Now().UTC().Truncate(time.Microsecond)` and
`uuid.New`. The truncation matters: Postgres stores microseconds, so without it a service
returns timestamps that differ from what it stored — invisible on macOS, whose clock is
already microsecond-grained, and a test failure on Linux CI. `WithClock`
and `WithIDGenerator` make tests deterministic; production callers pass no options.

## Actor attribution

Entities that record **who** changed them carry `CreatedByUserID`, `UpdatedByUserID`, and
`DeletedByUserID` (see [PPE preset type](specs/ppe-preset-type-service.md)).

The user ID is extracted from the JWT **in the transport layer** and passed into the domain
as an explicit argument — `Create(ctx, params, userID)`. The domain never reads a token,
never inspects claims, and never pulls an actor out of the context: it receives an
already-authenticated identity as data. This is the same boundary that keeps `net/http` out
of the domain, applied to auth.

`userID` is a `uuid.UUID`, required on every mutation — `uuid.Nil` is `ErrInvalid`. The
transport layer parses the JWT subject claim into a UUID and rejects a token whose subject
is not one; that is a 401, not a domain validation error. Verification lives in
`cmd/api/auth.go` — see [app scaffold](app-scaffold.md#auth).

`CreatedByUserID` and `UpdatedByUserID` are `uuid.UUID`; `DeletedByUserID` is
`*uuid.UUID` — nil on live rows, for the same reason `DeletedAt` is a pointer. The two
deletion fields are set together and are either both nil or both populated.

`CreatedByUserID` is set once and never changes. `UpdatedByUserID` is overwritten on each
update and records the *last* editor, not a history. A full change history is a separate
audit table, not more columns on the entity.

The actor columns carry a **foreign key to `users`**, added by migration 0006 — see
[user service](specs/user-service.md). A row attributed to an actor that does not exist is
rejected by the database, and the repository translates that violation into
`ErrActorNotFound` so it surfaces as a 401 rather than an opaque 500: the actor comes from
a verified token, so a token naming no user is an authentication problem, not a bad body.

A soft-deleted user still satisfies those keys, because the row remains. Attribution
history outlives the account, which is the same reason deletes are soft everywhere else.

The `*_by_user_id` fields are **rejected** in request bodies alongside `id` and the
timestamps: they come from the token, never from the client, or any caller could attribute
a change to someone else.

Not every domain records an actor — supplier and recipient have no such columns — but every
domain is still **authorized**: every route in the API requires a token, and every write
requires a role. Authorization and attribution are separate concerns, and a service that
does not record who changed a row still controls who may. See
[app scaffold](app-scaffold.md#roles-and-authorization).

## Soft delete

Deletes are always soft. The entity carries `DeletedAt *time.Time` — a pointer, so nil
means live and it maps cleanly to SQL `NULL` and `"deleted_at":null`. Tag it
`json:"deleted_at,omitempty"` so live rows omit it entirely, and add a `Deleted()` helper
rather than comparing timestamps at call sites.

Every repository read filters `deleted_at IS NULL`; a deleted row is `ErrNotFound`.
Writes guard on `deleted_at IS NULL` and report `ErrNotFound` when
`RowsAffected() == 0`, so deleting twice fails the second time instead of silently
rewriting the timestamp.

**Cross-domain rule:** a soft-deleted row unbinds any optional relation pointing at it.
A `PPE_Preset` referencing a deleted supplier resolves to no supplier and becomes
applicable to all suppliers — the same state as a preset with a NULL `supplier_id`.
Never hard-delete to satisfy a foreign key.

## Aggregates

Most services own one table. When a service owns a **parent and its children** — see
[PPE transaction](specs/ppe-transaction-service.md) — the rules above still hold, with
these additions:

- The parent is the only entry point. Child operations take the parent ID as well as the
  child ID, and routes nest (`/{id}/items/{itemID}`). There is no standalone child service.
- One `Repository` covers both tables, so a caller cannot mutate children while bypassing
  the parent's invariants.
- Soft-deleting the parent soft-deletes its children in the same SQL transaction. The
  cross-domain unbinding rule does **not** apply here: children are *owned*, not
  referenced, so they follow the parent instead of becoming orphans.
- Writes spanning both tables run in one SQL transaction, so derived parent state commits
  atomically with the child change that caused it.
- A child ID that exists under a *different* parent than the route names is `ErrNotFound`,
  not a 403 — it does not exist at that address, and saying otherwise would confirm records
  the caller did not ask for.

## Derived state

State computable from other fields is **computed, never accepted from the client** — a
transaction's `Closed`, a recipient's `FullName`. Storing it as an independent input lets
it contradict the fields it derives from, with no way to tell which is authoritative.

Such fields appear in responses, are rejected in request bodies alongside `id` and the
timestamps, and are recomputed after every operation that could change them. Caching one in
a column for query performance is fine; the service owns keeping it accurate.

**Derive inside the write, not before it.** When the value depends on sibling rows, reading
those siblings before the write is a lost update: two concurrent callers both read the
pre-write state, both reach the same stale conclusion, and the later commit silently
overwrites the earlier one. The repository must take a row lock on the aggregate root,
re-read the children under that lock, and apply the derivation in the same SQL transaction
as the change that triggered it.

The rule itself still belongs to the domain. Pass it in as a function over the children —
`Recompute` in [PPE transaction](specs/ppe-transaction-service.md) — so the repository
decides *when* to derive, never *what* closed means.

## Uniqueness alongside soft delete

Use a **partial unique index** so a name is unique only among live rows and frees up
after deletion:

```sql
CREATE UNIQUE INDEX <table>_name_live_idx ON <table> (lower(name)) WHERE deleted_at IS NULL;
```

Indexing `lower(name)` makes uniqueness case-insensitive. The `ByName` query must use the
same `lower(name) = lower($1)` expression so the lookup hits the index and agrees with
the constraint.

## Input and output shapes

`CreateParams`/`UpdateParams` carry only client-settable fields, so `id` and timestamps
cannot be forged. `Validate()` calls `Normalize()` first, and the service persists the
normalized values. The HTTP layer defines its own request struct and uses
`DisallowUnknownFields()` — an unexpected field is a 400, not a silent no-op. Update
replaces all mutable fields; clients send full desired state.

`List` returns `make([]T, 0)`, never nil, so an empty result marshals as `[]`.

Lookups and filters are **path segments, not query parameters** — `/by-name/{name}`, never
`?name=`. Filters compose by nesting: `/by-supplier/{id}/by-name/{name}`.

**Exception — paged search lists with independent, optional filters.** When a list takes
several filters that combine freely (History: employee × date range × status, plus
paging), nested segments would need a route per combination. Such a list uses query
parameters instead, and must: reject unknown parameters with 400, treat every filter as a
*filter* (no match is `200` with an empty page), and name the exception in its service
spec. `GET /api/v1/orders` is the only such route; see
[order service](specs/order-service.md#history--get-apiv1orders).

What the route returns determines its empty-result status:

- A **single-object lookup** (the value identifies at most one row, e.g. supplier's unique
  name) returns the object, or 404 when nothing matches.
- A **filter** (the value may match any number of rows) returns a list, and no match is
  `200 []` — never a 404. An empty result is not a missing resource.

Say which of the two a route is in the service spec; the same `/by-name/{name}` shape
serves both, and only the spec distinguishes them.

Literal segments (`/unbound`) outrank wildcards (`/{id}`) in Go's `ServeMux`, so a literal
filter route can sit beside an ID route without conflict, and a row whose *name* equals
that literal still routes correctly through `/by-name/{name}`.

## Testing

Two layers, both in the domain package:

- **`service_test.go`** — table-driven against an in-memory fake `Repository` that
  mirrors the contract (live-only reads, case-insensitive uniqueness). No Docker; runs in
  milliseconds.
- **`postgres_test.go`** — real Postgres, guarded by `API_TEST_DB_DSN` with `t.Skip` when
  unset, so `go test ./...` stays green with no database. Each test truncates first. These
  exist because the fake only *assumes* the partial index and soft-delete filters behave
  as designed; these verify it.

Tests must not assume an env var is unset — `make test-db` exports `API_DB_DSN` from
`.env`. Clear it explicitly with `t.Setenv(key, "")`.

## Checklist for a new domain service

1. Write `docs/specs/<name>-service.md`.
2. `internal/db/migrations/000N_<name>.up.sql` + `.down.sql` (table, partial unique index).
3. `internal/domain/<name>/` — the five files above.
4. `cmd/api/<name>-routes.go` — `register<Name>Routes(mux, svc)`.
5. Mount in `routes()` in `main.go` — the single composition point; see
   [app scaffold](app-scaffold.md).
6. Tests: `service_test.go` against a fake repo, `postgres_test.go` guarded by `API_TEST_DB_DSN`.
