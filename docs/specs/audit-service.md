# Audit service

The trail of every recorded change, and the **Audit log** that reads it: Administration's
screen of every change (`audit.read`), and the **Changes** section of an employee, a
catalogue item and an order in the staff app. Phase 1 of
[admin/audit-analytics-monitoring.md](../admin/audit-analytics-monitoring.md).

## What is recorded

`internal/audit` is infrastructure, not a domain: each domain service builds its events and
its repository calls `audit.Insert` (or `InsertAll`) inside the transaction that makes the
change. An event exists exactly when its change committed. The table is append-only
(migration `0002`, a trigger refuses UPDATE and DELETE).

`audit_events(id, actor_user_id, event, entity_type, entity_id, occurred_at, before, after,
request_id, session_id, source)`:

- `before` and `after` hold the changed fields only. A created record has no `before`; a
  deleted, activated or deactivated one usually has neither.
- `request_id`, `session_id` and `source` were added by migration `0023`. They are NULL on
  older rows, meaning "not recorded".
  - `request_id` is the request's `X-Request-ID`, made by the API for every request
    (`cmd/api/request.go`); a client's own value is ignored.
  - `session_id` is the sign-in (`user_sessions.id`) of the access token. There is no
    foreign key, since ended sessions are deleted after 30 days and the event outlives them.
  - `source` is one of:
    - `workwear` or `admin`: the `X-PPE-App` header that `@ppe/api-client` sends.
    - `public_link`: a `/api/v1/confirmations/` route.
    - `api`: any other client.
    - `system`: work done without a request, such as seeding.
- The HTTP layer puts these on the request's context (`audit.WithRequest`), and `audit.Insert`
  reads them from the context the repository writes with. **Domain services never read
  them**; they only pass their context on.

### Events

The catalogue is `audit.Events()` (`internal/audit/events.go`), in the Audit log filter's
order. `TestEveryDomainEventIsKnown` (`cmd/api`) keeps it equal to the domains' `Event*`
constants. `TestWebClientListsTheEvents` keeps it equal to `AUDIT_EVENTS` in
`@ppe/api-client` (`audit.ts`), which the apps' words are typed against.

| Area | Entity type | Events | Payload |
| --- | --- | --- | --- |
| `users` | `user` | `user.created`, `user.updated`, `user.roles_changed`, `user.activated`, `user.deactivated`, `user.password_changed` (by its user), `user.password_reset` (by an administrator), `user.deleted` | created: name, email, role_ids, is_active; updated: the changed name, email or language; passwords: none |
| `users` | `role` | `role.created`, `role.updated`, `role.deleted` | name, description, permissions |
| `employees` | `employee` | `employee.created`, `employee.updated`, `employee.sizes_changed`, `employee.deleted` | updated: the changed first and last name, code and preferred language, and `notes_changed: true` (never the notes text); sizes as before |
| `catalogue` | `catalogue_item` | `catalogue.created`, `catalogue.updated`, `catalogue.price_changed`, `catalogue.activated`, `catalogue.deactivated`, `catalogue.deleted` | updated: the changed name, details, size group, picture, display rank; price events as before |
| `item_sets` | `item_set` | `item_set.created`, `item_set.updated`, `item_set.deleted` | name, description, active, lines (`catalogue_item_id`, `default_quantity`), the changed ones on update |
| `orders` | `order` | `order.ordered`, `order.confirmation_link_created`, `order.confirmation_link_opened` (the employee's first opening, no actor, migration 0027), `order.given`, `order.deleted` | as before; opened has none |
| `assets` | `asset` | `asset.registered`, `asset.updated`, `asset.status_changed`, `asset.given`, `asset.returned`, `asset.marked_not_returned` ([asset-service.md](asset-service.md)) | registered: the asset's details (never its comment); updated: the changed ones and `comment_changed: true`; status: `connection_status`; given, returned, marked: `assignment_id`, `employee_id`, `employee_name`, and `given_date` with `document_hash`, `returned_date` or `whereabouts`. The Audit log names an asset by its inventory number |
| `settings` | `settings` | `settings.supplier_chat_changed`, `settings.default_sim_provider_changed` | supplier chat as before; default provider: `provider` |
| `audit` | `audit_log` | `audit.exported` (by its actor), `audit.purged` (by the system) | exported: the format, from, to and the filters given; purged: `older_than` (the first day kept) and `rows` |
| `security` | `access_review` | `access_review.completed` | after: how many `users`, `active_users`, `administrators`, `dormant` and `no_sign_in` accounts there were; a fresh entity id per review (`docs/specs/security-service.md`) |

**One save can record several events.** An employee edit can record `employee.updated`
and `employee.sizes_changed`. An item edit can record `catalogue.price_changed`, an
activation event and `catalogue.updated`. A user edit can record `user.updated`,
`user.roles_changed` and an activation event. Each event names one kind of change. The
mutations return `[]audit.Event`.

A save that changes nothing records nothing.

Sign-ins and sessions are not audit events: they are the security log (`auth_events`,
ADR 0003), shown on Security.

**Not recorded yet:**
- writes the data sync makes directly in the database as the sync user (migration `0011`).
  It should import through the API instead.

## API

| Route | Permission | Notes |
| --- | --- | --- |
| `GET /api/v1/audit-events` | `audit.read` | the Audit log, newest first, a page at a time |
| `GET /api/v1/audit-events/{id}` | `audit.read` | one event (single object, 404 on miss) |
| `GET /api/v1/audit-events/employees/{id}` | any signed-in user | an employee's Changes |
| `GET /api/v1/audit-events/catalogue/{id}` | any signed-in user | a catalogue item's Changes |
| `GET /api/v1/audit-events/orders/{id}` | any signed-in user | an order's Changes |
| `GET /api/v1/audit-events/assets/{id}` | any signed-in user | an asset's Changes, its assignments' events included |
| `GET /api/v1/audit-events/users/{id}` | `users.read` | a user's Changes |

**Changes routes:**
- They ask the record's own service first, so a record that does not exist or is deleted is
  a 404, as its page is.
- They return the newest `audit.HistoryLimit` (100) events, as a list.
- They sit under `/audit-events/` because `/employees/{id}/…` would clash with
  `/employees/by-name/{q}` in ServeMux.
- Each takes the permission that opens the record, not `audit.read`: whoever can open an
  employee can see who changed them.

**List:** `GET /api/v1/audit-events?area=&event=&actor=&entity_type=&entity_id=&from=&to=&after=&page_size=`.
- It is a filter. No match is `200 {"events": [], "next": null}`.
- Its filters combine freely, so it uses query parameters, the contract's exception for
  paged search lists (as `GET /api/v1/orders`).
- An unknown parameter, a repeated one or a malformed id is 400. An unknown area, event or
  entity type, an entity id without its type, or a type outside the area is 400 too.
- `from` and `to` are inclusive days in `API_ORG_TIMEZONE`. `to` before `from` is 400.
- `page_size` is 1–200, default 50.
- Paging is keyset on `(occurred_at, id)`. `next` is an opaque cursor that `after` takes,
  and it is null on the last page.

**Entry** (`audit.Entry`):
- The stored row, plus `area`.
- `entity_label`: the record's name now. That is an employee's full name, an item, set, user
  or role name, or an order's record number. Deleted records keep it, with
  `entity_deleted: true`.
- `actor_name`: the user's current name.
- `session_user_agent`: from `user_sessions` while that row is kept.

Indexes (migration `0023`): `(occurred_at DESC, id DESC)`, `(actor_user_id, occurred_at
DESC, id DESC)` and `(event, occurred_at DESC, id DESC)`, beside `0002`'s
`(entity_type, entity_id, occurred_at)`.

## Seals and Verify (migration 0026)

The append-only triggers stop honest mistakes. They do not stop someone who can switch
them off. Seals make such a change visible.

- **Sealing.** After each UTC day ends, plus an hour's grace (`SealGrace`), the hourly
  upkeep (`cmd/api/jobs.go`) hashes that day's events in `(occurred_at, id)` order into
  `audit_seals(day, rows, hash, prev_hash, sealed_at)`:
  - Each row's canonical form is a JSON array of every column, with `before` and `after` as
    Postgres prints `jsonb` and the time in UTC to the microsecond.
  - `hash` is SHA-256 over the previous seal's hash, the day, the count and the rows'
    digest.
  - A day without events is sealed too, so the chain has no holes. The first seal is the
    day of the oldest event.
  - With several instances, a second seal of a day is refused by its primary key
    (`ErrSealed`), and that instance stops.
- **`audit_seals` and `audit_purges`** are append-only like the trail.
- **Verify** (`Service.Verify`, the hourly upkeep, `POST /api/v1/audit-events/verify`, or
  `api -verify-audit`, which prints the result as JSON for the restore drill) recomputes
  every seal, oldest first. It reports the first day that differs:
  - `rows`: an event added or removed;
  - `hash`: an event altered;
  - `chain`: a seal does not follow the one before;
  - `gap`: a seal is missing.
- It also counts the events since the last sealed day, not yet sealed. The latest result is
  kept in memory, so it starts again at a restart, when the upkeep verifies first. The
  Overview raises `audit_seal_mismatch` (critical) from it for `audit.read`.
- An old backup holds the seals it was taken with, so it is a second witness.

## Timestamps (migration 0028)

Seals alone cannot catch someone with the owner's password who rewrites the whole chain.
Each seal is therefore anchored outside the database by a **trusted timestamp** (RFC 3161,
proposal 3.5 C, ADR 0003). A public timestamp service signs "this hash existed at this
time" with a certificate that chains to a public root, so a token cannot be made later with
an earlier time.

- **Where:** `API_AUDIT_TSA_URL`. Production defaults to DigiCert
  (`http://timestamp.digicert.com`, in `docker-compose.prod.yml`); empty turns timestamps
  off, which is the default in development, tests and e2e.
- **What leaves the server:** only the seal's 32-byte hash. The request is plain HTTP, as
  DigiCert's service is; the token is signed, so the transport does not matter.
- **Stamping.** After sealing, the hourly upkeep asks for a token for every seal without
  one, oldest first (`Service.StampDays`, `internal/tsa`). It stops at the first failure
  (`audit timestamping failed`) and carries on next hour.
  - The token is checked before it is stored: it must be a timestamp of that hash, signed
    for timestamping by a certificate chaining to Mozilla's roots (built into the binary,
    `x509roots/fallback/bundle`), valid at the time it states.
  - Tokens go to `audit_seal_stamps(day, tsa, token, stamped_at, recorded_at)`, which is
    append-only and refuses TRUNCATE like the seals.
- **Verify** checks each seal's token as well:
  - `stamp`: the token is not a trusted timestamp of the seal's hash, as after a rewrite;
  - `late`: it was made more than `StampGrace` (7 days) after the day could be sealed;
  - `unstamped`: the seal has no token after `StampGrace`.
  - The last two apply from `StampsFrom` (8 Oct 2026, when stamping began). The seals before
    it were stamped on its first run. The first seal stamped in time covers them all, through
    the chain.
  - Each problem is a mismatch: critical on the Audit log and the Overview.
- **Waiting.** A seal still waiting is counted (`stamps_waiting`). After a day
  (`StampOverdue`), the Overview warns `audit_not_timestamped`, so an unreachable service is
  put right before the grace ends.
- **Checking a stamp yourself**, independently of the app, with OpenSSL and any CA bundle:

  ```bash
  psql -Atc "SELECT encode(a.hash, 'hex'), encode(s.token, 'hex') FROM audit_seal_stamps s JOIN audit_seals a USING (day) WHERE day = '2026-10-08'" |
    { IFS='|' read -r hash token; echo "$token" | xxd -r -p > stamp.der
      openssl ts -verify -token_in -in stamp.der -digest "$hash" -CAfile /etc/ssl/certs/ca-certificates.crt; }
  openssl ts -reply -token_in -in stamp.der -text | grep 'Time stamp'
  ```

## Retention

- **`API_AUDIT_RETENTION`:**
  - default `87672h` (10 years, pending the accountant's word, ADR 0003);
  - from `8784h` to `175680h` (1–20 years);
  - set in configuration, never on a screen.
- **The hourly upkeep purges** the events before the first kept UTC day, and only days
  already sealed (`Service.PurgeExpired`).
  - It deletes through `purge_audit_events(boundary)`, a `SECURITY DEFINER` function owned
    by the owner, because the API's role has no DELETE. The function refuses a boundary
    under 365 days old.
  - It runs under an advisory lock, and in one transaction it:
    - deletes the events;
    - records `audit_purges(before_day, rows)`;
    - writes `audit.purged`.
  - Verify then checks the purged days by their seals' chain only.

## Export

`GET /api/v1/audit-events/export?format=csv|jsonl&from=&to=&<the list's filters>`
(`audit.export`, which needs `audit.read`):
- `from` and `to` are required, at most 366 days apart.
- **CSV:** columns `occurred_at` (organisation timezone), `event`, `area`, `entity_type`,
  `entity_id`, `entity_label`, `entity_deleted`, `actor_id`, `actor_name`, `source`,
  `request_id`, `session_id`, `before`, `after`, `id`. Names starting with `= + - @` get a
  leading apostrophe, against formula injection.
- **JSONL:** one `Entry` a line.
- Newest first, read a thousand at a time. `Content-Disposition` names it
  `audit-log-<from>-<to>.<format>`.
- **The export is recorded first** (`audit.exported` with its filters), so an export cut
  short is on the trail too. A refused one (400) records nothing.

## The API's database role

- The API connects as **`ppe_app`** (`internal/db/grants.sql`, ADR 0003 item 5) once
  `API_DB_USER=ppe_app` and `API_DB_PASSWORD` are set in production. `deploy/migrate.sh`
  gives the role that password.
- What `ppe_app` may do:
  - it may: SELECT, INSERT, UPDATE and DELETE the business tables; INSERT and SELECT only
    on `audit_events`, `auth_events`, `audit_seals`, `audit_purges` and `order_lines`;
  - it may not: truncate, alter, or create anything.
- The owner runs the migrations, the backups and the purge functions.
- `grants.sql` is applied after the migrations on **every** run. That keeps it right for
  every table, and puts the grants back after a restore, since dbbackup restores with
  `--no-acl`.
- System shows the role the API connects as. The Overview raises
  `database_owner_rights` (warning) when it is the owner or a superuser.

**TRUNCATE guard.** A statement trigger refuses TRUNCATE on the five trails, which a
cascade from `users` would reach, unless the transaction says
`SET LOCAL ppe.allow_truncate = on`. Test setup does.

## Permission

`audit.read` (group administration) opens the Audit log; `audit.export` (migration 0026,
needs `audit.read`) adds Export. Migration `0023` grants it to the
built-in Administrator, and `ADMINISTRATION_PERMISSIONS` lists it, so the staff app links to
Administration for whoever holds it.

## Screens

**Administration → Audit log** (`/admin/audit`, `web/apps/admin/src/routes/audit.tsx`):
- **Seals**: through which day the log is sealed, whether the latest check found every
  sealed day whole (or an alert naming the day that is not), through which day the seals
  are timestamped and by which service (or that they are not), how many years changes are
  kept, and **Verify** to check now.
- **Export** (with `audit.export`): a sheet with from and to (the filter's days, else the
  last 30) and CSV or JSON lines; the file downloads, and the export is on the log.
- **Filters**: area, change (narrowed to the area), person (with `users.read`), from and to.
  They live in the address, so a filtered view can be bookmarked or sent.
- **Record filter**: `entity_type` and `entity_id` narrow the list to one record. It is shown
  as "Record: …" with All records beside it, and reached from a change's "All changes to
  this record" and from a user's ⋯ → Changes on Users.
- **The list**: when, change (and the record's name), who, made in. Older pages load with
  Show older changes.
- **One change** opens at `/audit/<id>`: beside the list from `lg`, in its place below. It
  shows:
  - the record, linked to its page in the staff app (Roles and the access review here; none
    for users, settings and deleted records);
  - when (absolute, in the organisation's timezone), who, made in, device, reference, event;
  - every field it changed.

**Changes** on the staff app's employee page, catalogue item page and order (beside Orders):
- the record's changes, newest first;
- loaded again when the record changes on the page.

`@ppe/audit` holds the words for both apps, in EN/LT/RU:
- each event as an action ("Price changed"), shown beside the record's name rather than
  inside a sentence, so names are never inflected;
- field names, and values in the language in use: euros, months, sizes, languages, roles
  and permissions by name where the app knows them.

The glossary's "History" means Orders, so a record's section is called Changes.

## Not here yet

- A second timestamp service, as a fallback when the first does not answer.
