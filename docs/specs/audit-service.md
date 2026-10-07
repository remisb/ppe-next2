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
| `orders` | `order` | `order.ordered`, `order.confirmation_link_created`, `order.given`, `order.deleted` | as before |
| `settings` | `settings` | `settings.supplier_chat_changed` | as before |

**One save can record several events.** An employee edit can record `employee.updated`
and `employee.sizes_changed`. An item edit can record `catalogue.price_changed`, an
activation event and `catalogue.updated`. A user edit can record `user.updated`,
`user.roles_changed` and an activation event. Each event names one kind of change. The
mutations return `[]audit.Event`.

A save that changes nothing records nothing.

**Not recorded yet:**
- sign-ins and sessions (phase 2, `auth_events`);
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

## Permission

`audit.read` (group administration) opens the Audit log. Migration `0023` grants it to the
built-in Administrator, and `ADMINISTRATION_PERMISSIONS` lists it, so the staff app links to
Administration for whoever holds it.

## Screens

**Administration → Audit log** (`/admin/audit`, `web/apps/admin/src/routes/audit.tsx`):
- **Filters**: area, change (narrowed to the area), person (with `users.read`), from and to.
  They live in the address, so a filtered view can be bookmarked or sent.
- **Record filter**: `entity_type` and `entity_id` narrow the list to one record. It is shown
  as "Record: …" with All records beside it, and reached from a change's "All changes to
  this record" and from a user's ⋯ → Changes on Users.
- **The list**: when, change (and the record's name), who, made in. Older pages load with
  Show older changes.
- **One change** opens at `/audit/<id>`: beside the list from `lg`, in its place below. It
  shows:
  - the record, linked to its page in the staff app (Roles here; none for users, settings
    and deleted records);
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

- Sign-in events, the Security screen and access review (phase 2).
- The request ID in error responses and logs (phase 3).
- Seals, the least-privilege database role, retention and export (phase 4).
