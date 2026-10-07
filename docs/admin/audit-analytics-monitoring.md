# Audit, Analytics and Monitoring in Administration

Research report and proposal for Workwear & Equipment (PPE-next2). It looks at what the
system records and observes today, then proposes what Administration (`/admin/`) should
add: an **audit log** to review and manage, **usage analytics**, and **monitoring**.
Each area has options, pros and cons, and a recommendation. The report ends with a roadmap
in phases.

7 Oct 2026 · reviewed build `6747260` · status: **phases 0 and 1 built; phases 2–5 proposed**

> **Status, 7 Oct 2026.** Phase 0's code is done: `GET /ready`, the image healthcheck
> (`/api -healthcheck`), the commit in `/ready`, log rotation on every prod service, and
> `make prod-up` waiting for `/ready`. See [monitoring.md](../monitoring.md). The external
> uptime check and the DigitalOcean alerts are account settings, described there, for a
> person to make. One correction to 5.1 below: Docker does not restart an unhealthy
> container; the healthcheck only reports.
>
> **Phase 1 (Audit log) is built**, as described in
> [specs/audit-service.md](../specs/audit-service.md), with these differences from section 3:
> - A record's list of changes is called **Changes**, because the glossary keeps "History"
>   for Orders.
> - Its routes are `GET /api/v1/audit-events/{employees|catalogue|orders|users}/{id}`;
>   `/employees/{id}/history` would clash with `/employees/by-name/{q}`.
> - The request ID is made by the API for every request (`X-Request-ID`); it is not yet in
>   error responses (phase 3).
> - A user's Changes open the Audit log filtered to them (⋯ → Changes on Users), since
>   Administration has no user page.
> - Export, Verify and retention remain phase 4.

---

## 1. Summary

- **The audit trail is sound, but narrow and nobody can read it.** Each `audit_events` row is
  written in the same transaction as its change, and the database rejects updates and
  deletes. But only 15 event types are recorded:
  - Not audited: user accounts (except their roles), sign-ins, item sets, and most edits to
    names and details.
  - The only readers are an item's price history and the Manager Dashboard.
- **There is no security trail.** Failed sign-ins are counted in memory and forgotten when the
  API restarts. Session rows (IP, device, end reason) are deleted 30 days after they end.
- **Monitoring is a log stream and a `/health` that never fails.** There are no metrics,
  request IDs, error list, uptime check or alerts. Backups are the one thing watched
  properly, on the Backups screen.
- **Recommendation:** grow Administration from 4 screens to 7, in five phases.
  - **Overview** answers "is anything wrong?"
  - **Audit log** answers "who changed what?"
  - **Security** covers sign-ins, sessions and an access review.
  - **System** covers health, errors, the database and backups.
  - **Usage** covers adoption.
- Everything stays first-party: in this API, this database and this origin. That fits the
  2 GB droplet, the Content-Security-Policy (`connect-src 'self'`) and GDPR.
- Two cheap actions come before any screen: Docker log rotation, and an uptime check
  hosted somewhere other than the droplet.

| Phase | What | Size |
| --- | --- | --- |
| 0 | Monitoring quick wins: log rotation, API healthcheck, `/ready`, external uptime check, droplet alerts | S |
| 1 | Audit log screen, indexes, History panels on records, missing events, request context | M |
| 2 | Security events, Security screen, access review, sign-in limiter in Postgres | M |
| 3 | Request IDs, metrics, error list, System screen, Overview with attention items | M |
| 4 | Audit integrity and retention: least-privilege DB role, TRUNCATE guard, daily seals, export, purge jobs | M–L |
| 5 | Usage analytics, shared charts, confirmation-link funnel | M |

---

## 2. What exists today

### 2.1 The audit trail

`internal/audit/audit.go`, migration `0002_audit_events`:

```
audit_events(id, actor_user_id → users, event, entity_type, entity_id,
             occurred_at, before JSONB, after JSONB)
index: (entity_type, entity_id, occurred_at)
trigger: BEFORE UPDATE OR DELETE … FOR EACH ROW → raise 'append-only'
```

Services build the event inside the repository's `Mutation` callback, and the repository
calls `audit.Insert` with the same `pgx.Tx`. An event therefore exists exactly when its
change committed (`TestPostgresFailedWriteRecordsNoEvent`).

**Recorded today (15 event types):**

| Area | Events | Payload |
| --- | --- | --- |
| Employee | `employee.created`, `employee.sizes_changed`, `employee.deleted` | sizes before / after |
| Catalogue | `catalogue.created`, `catalogue.price_changed`, `catalogue.activated`, `catalogue.deactivated`, `catalogue.deleted` | prices and service period |
| Role | `role.created`, `role.updated`, `role.deleted` | name, description, permissions |
| User | `user.roles_changed` | role ids before / after |
| Order | `order.ordered`, `order.deleted`, `order.confirmation_link_created`, `order.given` | record number, lines, total; method, document hash, confirmed name |
| Settings | `settings.supplier_chat_changed` | group name and link |

**Readers:** an item's price history (`GET /api/v1/catalogue/{id}/price-history`), and the
Manager Dashboard's eight latest price changes. There is no general query API and no screen.

**Gaps:**

| Gap | Effect |
| --- | --- |
| Users are not audited: create, name/email/language edits, activation, password change and reset, delete | The most sensitive changes leave no trace; only role changes do |
| Sign-ins, failed sign-ins, sign-outs and stolen-cookie detection (`end_reason = reused`) | No security history; session rows are deleted 30 days after ending |
| Item sets; employee name, code, notes and language; catalogue name, details and icon | "Who renamed this?" cannot be answered |
| The data sync writes tables directly as the sync user (migration 0011) | Synced employee changes bypass every service, so no events are written |
| No request context: request id, session, client address, source | An event cannot be tied to a sign-in or a log line |
| Only an entity index | Searching by time, person or event type scans the table |
| `TRUNCATE` is not blocked (row triggers do not fire on it), and `TRUNCATE users CASCADE` empties the table through the actor foreign key | The append-only guarantee has a hole |
| The API connects as the database owner | Any bug or leaked credential could `DROP TRIGGER` |
| No seal or hash chain | Tampering could not be detected |
| No retention policy; payloads hold personal data (`confirmed_name`, sizes) | Kept forever; conflicts with ADR 0001's "IDs and field names only" for HR data |

### 2.2 Sessions and sign-in

- `user_sessions` (migration 0020) stores per session: IP, user agent, created, last used,
  `authenticated_at`, `keep_signed_in` and end reason.
  - End reasons: `signed_out`, `ended_elsewhere`, `password_changed`, `password_reset`,
    `deactivated`, `deleted` and `reused`.
  - Ended rows are pruned after 30 days.
- Sign-in limits:
  - per IP, by muxstack `RateLimiter` (5 per minute);
  - per email, in memory (`cmd/api/login-limit.go`, 10 failures per 15 min).
  - Nothing is persisted. ADR 0001 already requires moving the email limiter to Postgres
    before a second API instance runs.
- Users have no last-sign-in column.

### 2.3 Monitoring and operations

| Area | Today |
| --- | --- |
| Logs | `slog` JSON to stdout; one `request` line per request (method, path, status, bytes, duration, client IP); unmapped errors logged as `request failed` |
| Health | `GET /health` returns `{"status":"ok"}` without touching the database; no `/ready` |
| Containers | Only `db` has a healthcheck; no Docker log rotation (`json-file` grows until the disk is full) |
| Metrics | none |
| Request IDs | none |
| Caddy | no `log` directive, so no access log; security headers and a strict CSP |
| Backups | watched well: `Stale`, `AgentOffline` and `LastRunFailed` on the Backups screen and a Dashboard card |
| Version | the API reports no version or commit |
| Alerts | none; the app sends no email |
| Host | one DigitalOcean droplet, 2 GB RAM |

### 2.4 The Administration app

- Four screens: Users, Roles & permissions, Settings and Backups.
  - They are registered in `web/apps/admin/src/lib/router.ts` (`screens`, each with a
    permission) and in `app.tsx` (`sections()`).
  - The phone bar shows up to six columns and has a **More** sheet.
- The staff app links to Administration when the user holds one of
  `ADMINISTRATION_PERMISSIONS` (`@ppe/app-shell`).
- There is no chart library. The staff Dashboard's `MonthChart` is hand-built bars with a
  hidden table, and lives in the workwear app, not in `@ppe/ui`.
- Permission catalogue (`internal/domain/role/permission.go`), grouped administration /
  workwear / dashboards: `users.read`, `users.manage`, `roles.manage`, `settings.manage`,
  `backups.read`, `employees.delete`, `catalogue.manage`, `item_sets.manage`,
  `orders.delete`, `dashboard.overview`, `dashboard.manager` and `dashboard.employee`.

---

## 3. Audit log: review and management

### 3.1 The Audit log screen

A new screen at `/admin/audit`, opened by a new permission **`audit.read`**.

**List.** Newest first, one row per event:
- when (relative date, with the exact time in the organisation's timezone)
- who (person's name, or "Confirmation link" / "Data sync" / "System")
- what, as a sentence in the user's language: "Changed the price of *Safety boots S3* from
  €42.00 to €45.50"
- the record, linked to it in the staff app

**Filters:**
- period: today, 7 days, 30 days or custom
- person
- area: Users & roles, Employees, Catalogue, Item sets, Orders, Settings, Sign-in
- event type, within the area
- record: picked from a search, or opened from a record's History link

Filters live in the address (`?area=catalogue&from=…`), so a filtered view can be shared
with another administrator.

**Detail sheet.**
- Before and after as a table of fields, each named by its translated label: old value
  struck through, new value highlighted.
- The raw JSON is behind a "Show data" toggle.
- The context: request ID, session (device and address, from Security), and source.
- "Open record" link.

**History panels on records.** The Employee, Catalogue item, Order and User pages get a
History panel with the same rows, filtered to that record. The catalogue item's price
history becomes one view of it. Managers see History on the records they can already open,
without `audit.read`. This needs a per-entity read rule: one may read the history of a
record one may read.

**API.**
- `GET /api/v1/audit-events?area=&event=&actor=&entity_type=&entity_id=&from=&to=&after=`:
  `audit.read`; keyset pagination on `(occurred_at, id)`; at most 100 rows a page.
- `GET /api/v1/audit-events/{id}`: one event with its context.
- `GET /api/v1/{employees|catalogue|orders|users}/{id}/history`: the record's events, under
  the record's own read permission.

The query-parameter filters follow the Orders list (Slice 5), not path segments, because
they combine freely.

**Indexes** (one migration):

```sql
CREATE INDEX audit_events_time_idx  ON audit_events (occurred_at DESC, id DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id, occurred_at DESC);
CREATE INDEX audit_events_event_idx ON audit_events (event, occurred_at DESC);
```

**Describing events.** A small typed registry in `@ppe/api-client` or the admin app maps
each event name to an area, an icon, a sentence template and field labels, in EN/LT/RU.
A test fails when Go emits an event the registry does not know, the same way
`permissions.ts` is checked against `permission.go`. Unknown events still show, with their
raw name.

### 3.2 Complete the coverage

New events, each recorded by the service that owns the change:

| Area | New events | Payload rule |
| --- | --- | --- |
| Users | `user.created`, `user.updated` (name, email, language), `user.activated`, `user.deactivated`, `user.deleted`, `user.password_changed`, `user.password_reset` | password events carry no values; email and name changes carry field names and values |
| Item sets | `item_set.created`, `item_set.updated`, `item_set.deleted` | name, items and quantities |
| Employees | `employee.updated` (name, code, notes, language) | field names; notes text not stored, only "notes changed" |
| Catalogue | `catalogue.updated` (name, details, icon) | field names and values |
| Orders | `order.confirmation_link_opened` (first open only) | none; feeds the funnel in section 4 |
| Settings | already covered | none |
| Audit itself | `audit.exported`, `access_review.completed` | filters used; number of rows |

**Data sync.** It writes as the sync user directly into the tables, so no event is written.
Two options:

| | A. Import through the API (ADR 0001's plan) | B. Database trigger on synced tables when the actor is the sync user |
| --- | --- | --- |
| Pros | One code path; real events; validation | Small; no change to the sync |
| Cons | Changes data-sync-ui | Events built by SQL, outside the service rules |

**Recommendation: A.** ADR 0001 already requires it. Until then, the Audit log shows synced
records' `updated_by` as "Data sync" where it is known.

### 3.3 Request context on events

Add context so an event can be traced to the sign-in and log line that caused it.

| | A. Columns on `audit_events` | B. One `context JSONB` column |
| --- | --- | --- |
| Shape | `request_id TEXT`, `session_id UUID`, `source TEXT CHECK (source IN ('staff','admin','public_link','sync','system'))` | `{request_id, session_id, source, ip, user_agent}` |
| Pros | Typed, indexable, enforced by CHECK | Flexible |
| Cons | One migration per new field | Unchecked; tempting to dump personal data in it |

**Recommendation: A.**
- The client IP and user agent are **not** copied onto audit events. They stay on the
  session and the security event, which have a short retention (3.4). An administrator
  reaches them through `session_id` while that record still exists.
- `request_id` comes from the request-ID middleware (Phase 3).
- `source` is set where the service is called: the API's handlers pass a small
  `audit.Context` on the `context.Context`, and `audit.New` reads it.

### 3.4 Security events

Sign-ins need their own record.

| | A. Same `audit_events` table | **B. A separate `auth_events` table** |
| --- | --- | --- |
| Volume | high (every refresh, failed attempt), drowns business changes | kept apart |
| Personal data | IP and user agent on rows that are kept for years | IP kept only as long as security needs it |
| Retention | append-only trigger forbids purging | its own retention (default 180 days) and a purge job |
| Unknown accounts | a failed sign-in for an unknown email has no `entity_id` | `user_id` nullable; the attempted email stored as a keyed hash, so repeated attempts group without storing the address |

**Recommendation: B.**

```
auth_events(id, occurred_at, kind, user_id NULL, email_hash NULL,
            session_id NULL, ip INET, user_agent TEXT, reason TEXT NULL)
kind ∈ sign_in, sign_in_failed, signed_out, refresh_reused, reauth,
       reauth_failed, rate_limited, session_ended
reason (for failures) ∈ bad_password, unknown_email, inactive, rate_limited
```

- Written by `internal/domain/session` and the sign-in handlers.
- A Postgres-backed failure count replaces the in-memory `emailLimiter`, which ADR 0001
  requires before a second API instance runs.
- Append-only like `audit_events`, but its trigger lets only the purge job delete rows,
  through a `SECURITY DEFINER` function that deletes rows older than the configured
  retention.
- `users.last_sign_in_at` is updated alongside, for the access review.

### 3.5 Integrity: making the trail tamper-evident

The trigger stops honest mistakes. It does not stop a credential that can drop it.

**Step 1: least privilege (recommended, needed by every option).**
- Migrations run as the owner role.
- The API connects as a new role, `ppe_app`, with `INSERT, SELECT` only on `audit_events`,
  `audit_seals` and `auth_events`. It has no `UPDATE`, `DELETE`, `TRUNCATE` or `ALTER` there.
- This is the first piece of ADR 0001's per-schema roles.
- Effect on tests: Postgres tests and e2e setup keep truncating as the owner (the test DSN).
  Only the production and dev API DSN changes. `deploy/migrate.sh` creates the role and
  grants.
- Add a `BEFORE TRUNCATE` statement trigger as defence in depth, with a documented
  `SET LOCAL ppe.allow_truncate = on` escape hatch used only by test setup.

**Step 2: detection.**

| | A. Hash chain per row | **B. Daily seals** | C. Seals anchored outside the database |
| --- | --- | --- | --- |
| How | each row stores `hash = sha256(prev_hash ‖ row)`, under an advisory lock | after each day (+1 h grace), a job hashes that day's rows in `(occurred_at, id)` order into `audit_seals(day, rows, hash, prev_hash, sealed_at)`; seals chain to each other | B, plus each seal written to the backup bucket (object lock) or sent by email |
| Pros | detects any change at once | no lock on the write path; one row a day; simple to verify | survives a full database compromise |
| Cons | serialises every audited transaction; harder with commit-order vs insert-order | today's rows are open until sealed | needs the outbox or bucket credentials in the API |

**Recommendation: B now, C later.**
- The Audit log screen gets **Verify**: it recomputes the seals for a period and reports
  "All 214 days match" or names the first day that does not.
- Backups already copy the seal table, so an old backup is a second witness.

### 3.6 Retention, export and GDPR

| Data | Proposed retention | Why |
| --- | --- | --- |
| Business audit events (`audit_events`) | **10 years**, then purged by year | Orders and receipts are accounting records; Lithuanian accounting documents are commonly kept 10 years. **Confirm with the accountant.** |
| Security events (`auth_events`) | **180 days** | Long enough to investigate an incident; IPs are personal data |
| Ended sessions (`user_sessions`) | 30 days (unchanged) | |
| Error events (Phase 3) | 30 days | |

- **Set in configuration, not on a screen**: `API_AUDIT_RETENTION`, `API_AUTH_EVENTS_RETENTION`,
  each read in `loadConfig` and checked in `validate`. A retention control in the UI would
  let one compromised admin account erase history. The System screen *shows* the values.
- **Purge and seal jobs.** They run inside the API on a ticker, under a Postgres advisory
  lock so only one instance runs them, until ADR 0001's worker exists. The audit purge is the
  only deleter. It goes through a `SECURITY DEFINER` function that refuses rows newer than
  the retention, and it writes an `audit.purged` event and a seal note.
- **Personal data in new events.** Record IDs and field names. Record values only where the
  value is the business fact (a price, a size, a status). Never record passwords, notes text
  or ID numbers. Existing events stay as they are.
  - `order.given`'s `confirmed_name` is part of the receipt, which is the legal document.
- **Export** (`audit.export`, separate from reading): CSV for spreadsheets or JSONL for
  archives, of the current filter. The response is streamed, at most one year per export.
  Each export writes `audit.exported`.

---

## 4. Analytics

Business analytics (orders, spend, replacements, confirmation methods) already live on the
staff app's three Dashboards and stay there. Administration's analytics are about **the
system and its people**: is it used, by whom, and is access right?

### 4.1 Usage screen (`usage.read`)

| Figure | Source |
| --- | --- |
| Active people per day / week / month, by role | `auth_events` (sign-in, refresh) and `user_sessions.last_used_at` |
| Sign-ins per day and failed sign-ins | `auth_events` |
| Devices and browsers (phone / tablet / desktop; browser family) | user agent, parsed into a family on write |
| Language mix of users and employees | `users.language`, `employees.language` |
| Changes per area per week (a heat strip) and the most active people | `audit_events` |
| Confirmation-link funnel: created → opened → given, and expired | `order.confirmation_link_created`, the new `_opened`, `order.given` (method `ELECTRONIC`), confirmations past `expires_at` |
| Data quality trend: employees without sizes, unpriced items | the Dashboard's `Setup` figures, kept as a daily snapshot |

There are no page-view trackers. The CSP blocks third-party scripts anyway, and server
events answer the questions above without a consent banner.

| | **A. First-party, from server events (recommended)** | B. Self-hosted Umami / Plausible | C. Hosted analytics |
| --- | --- | --- | --- |
| Fits the CSP | yes | needs a proxy path on the same origin | needs CSP changes |
| GDPR | data already held for the service | another store of personal data | data leaves the organisation |
| Cost on a 2 GB droplet | none | +150–300 MB RAM, another database | none |
| Answers | who uses which part, adoption by role | page views, paths | page views, paths |

### 4.2 Access review (on Security)

A periodic check, as ISO 27001 and most client audits expect.

- One row per user: name, roles, effective permissions (expanded), last sign-in, active
  sessions and created date.
- Flags:
  - **dormant** (no sign-in for 90 days)
  - **never signed in**
  - **holds Administrator**
  - **role with no users**
- **Mark as reviewed** records `access_review.completed` with the date and reviewer.
- The Overview reminds administrators when the last review is older than 90 days.

### 4.3 Charts

| | **A. Hand-built SVG in `@ppe/ui` (recommended)** | B. uPlot (~50 KB) | C. Recharts (~100 KB+, React) |
| --- | --- | --- | --- |
| Fits house style | yes; same as `MonthChart` | needs styling | needs styling |
| Accessibility | a visually hidden table, as `MonthChart` does | add yourself | partial |
| Bundle | ~0 | small | large |
| Needed shapes | bars per day/week, sparkline, stacked bar, heat strip | all | all |

Move `MonthChart` from `web/apps/workwear/src/components/dashboard.tsx` into
`@ppe/ui/charts` first, so both apps share it, then add `Sparkline`, `StackedBar` and
`HeatStrip`.

---

## 5. Monitoring

### 5.1 Tier 0: quick wins (do first)

| Action | Where | Why |
| --- | --- | --- |
| Log rotation: `logging: {driver: json-file, options: {max-size: 10m, max-file: "5"}}` on every service | `docker-compose.prod.yml` | Today, Docker's logs grow until the droplet's disk is full |
| `GET /ready`: pings the database and checks the latest migration is applied; `/health` stays a liveness check | `cmd/api` | `/health` says ok while the database is down |
| API healthcheck: `/api -healthcheck` probes `/ready` | the image's `HEALTHCHECK` (scratch has no curl) | `make prod-ps` shows healthy or unhealthy, and `make prod-up` waits for `/ready`. Docker does not restart an unhealthy container. |
| External uptime check on `https://workwear.gavort.nl/ready` and TLS expiry, every 1–5 min, email alerts | Better Stack or UptimeRobot free tier (EU) | A monitor on the droplet cannot report the droplet's own failure |
| DigitalOcean monitoring agent: CPU > 80 %, memory > 85 %, disk > 80 % alerts | droplet | Free; covers the host the app cannot see |
| The commit in the API (`git describe` via `-ldflags`), returned by `/ready`; shown in Administration with the System screen (Phase 3) | `Dockerfile`, `Makefile`, `cmd/api` | Know what is deployed |

### 5.2 Tier 1: in the app

**Request IDs.**
- A middleware reads or creates `X-Request-ID`, puts it in the `context.Context`, adds it
  to every log line and returns it in the response.
- Error responses gain a reference: `{"error":"…","reference":"9f2c…"}`. The app shows
  "Reference 9f2c…" so a person can quote it.
- Audit events store it (3.3).

**Error list.**
- An `error_events` table holds 5xx responses, recovered panics and client errors.
  - Fields: request ID, route pattern, status, message, a stack fingerprint, user, time and
    count.
  - Identical errors within an hour are folded into one row with a count.
- Kept 30 days.
- Client errors come through `POST /api/v1/client-errors`, rate-limited per session, from a
  `window.onerror` / `unhandledrejection` reporter in `@ppe/app-shell`. It is same-origin,
  so the CSP is unchanged.
- This is Sentry's useful core without a third party.

**Metrics.**
- A Prometheus `/metrics` endpoint on a second, internal listener (`API_METRICS_ADDR`, e.g.
  `:9090`) that Caddy never proxies.
- Contents:
  - requests by route pattern, method and status
  - latency histogram
  - `pgxpool` stats (acquired, idle, waits)
  - Go runtime
  - sign-in failures, rate-limit hits and refresh-token reuse
  - audit events written
- Nothing reads it yet. It is ready for Tier 2 or `curl` during an incident.

**Live figures for the screen.**
- The API keeps a rolling 24-hour window in memory: 5-minute buckets of request count,
  5xx count and latency percentiles.
- They reset on restart, which is acceptable for a status view; history belongs in Tier 2.

**System screen (`system.read`):**

| Panel | Contents |
| --- | --- |
| Service | version, commit, started, uptime, Go version, `/ready` result |
| Requests (24 h) | requests per 5 min, error rate, p50/p95 latency, slowest routes |
| Errors | recent error events, grouped, with count, first/last seen, reference; opens the detail |
| Database | Postgres version, database size and growth, largest tables, connections and pool, latest migration, oldest open transaction |
| Backups | the current Backups screen, moved here as a tab |
| Retention | configured retention, last purge, last seal and its verification |

**Overview (landing page of Administration).** Attention items first, figures second.
Every item links to where it is resolved.

| Severity | Item | Rule |
| --- | --- | --- |
| critical | Backups are not running | backup `Stale` or `AgentOffline` (exists) |
| critical | A refresh token was reused | any `refresh_reused` in 7 days: possible stolen cookie |
| warning | Failed sign-ins spiked | > 20 in an hour, or > 5 for one account |
| warning | Errors | ≥ 1 % of requests failed in the last hour, or a new error type |
| warning | Access review is overdue | > 90 days since `access_review.completed` |
| warning | Audit seal mismatch | Verify found a difference |
| info | Database grew fast | > 20 % in 30 days |

### 5.3 Tier 2: a monitoring stack (later)

| | Self-hosted Prometheus + Grafana + Loki | **Grafana Cloud free tier, EU, with Alloy** | Tier 1 only |
| --- | --- | --- | --- |
| RAM on droplet | 0.6–1 GB, too much for 2 GB | ~100 MB agent | none |
| History | full | 14 days logs, 13 months metrics | 24 h, in memory |
| Alerting | Alertmanager | built in (email, Telegram) | Overview + external uptime |
| Data leaves the server | no | yes (metrics; logs if sent) | no |

**Recommendation:** stay on Tier 0 + Tier 1. Move to Grafana Cloud when one of these happens:
- a second API instance runs;
- more contexts (People, Timesheets) arrive;
- someone needs longer history than the error list and the uptime check give.

The `/metrics` endpoint and JSON logs make that a configuration change, not a rewrite.

### 5.4 Alert delivery

- **Now:** the Overview and the external uptime monitor's email.
- **Later:** when ADR 0001's outbox and worker exist, the attention items become events, and
  the worker sends them by email (SMTP via the organisation's mailbox) or to a Telegram
  chat, configured on Settings. The app has no email sender today.

---

## 6. Administration after the change

**Main navigation**, in order, each screen opened by one permission:

| Screen | Permission | New? |
| --- | --- | --- |
| Overview | any Administration permission | new |
| Users | `users.manage` | |
| Roles & permissions | `roles.manage` | |
| Audit log | `audit.read` | new |
| Security | `security.read` | new |
| System (with Backups as a tab) | `system.read`, Backups tab `backups.read` | new |
| Usage | `usage.read` | new |
| Settings | `settings.manage` | |

- On a phone: Overview, Users, Audit, Security and System are in the bar; Roles, Usage and
  Settings move into **More**.
- **New permissions** (group *administration*):
  - `audit.read`
  - `audit.export` (requires `audit.read`)
  - `security.read`
  - `system.read`
  - `usage.read`
- The built-in Administrator gets all of them through a migration inserting `role_permissions`
  rows. `TestBuiltinsGrantKnownPermissionsWithTheirRequirements` already expects
  Administrator to hold every permission except the three dashboard and order ones.
- Each permission also needs:
  - its key in `permissions.ts`
  - its words in `roles.ts` (EN/LT/RU)
  - an entry in `ADMINISTRATION_PERMISSIONS`
  - a row in `routes_test.go`'s `policy` for its routes
- **New terms** go into `docs/ubiquitous-language.md` before use: *Audit log*, *History*
  (of a record), *Security event*, *Access review*, *Seal*, *Error reference*, *Attention
  item*.

---

## 7. Roadmap

Each phase is a slice in the usual shape: spec first (`docs/specs/`), then migration,
domain service, routes with route-policy entries, client, screen in EN/LT/RU, Postgres
tests, an e2e step, and `docs/testing.md`. An **ADR 0003, audit integrity and retention**
records the decisions in 3.4–3.6 before Phase 2.

### Phase 0: monitoring quick wins · S · built
- Log rotation on every compose service. **Done.**
- `/ready`, the API healthcheck and the commit via ldflags. **Done.**
- External uptime + TLS check; DigitalOcean alerts. **To set up in those accounts**
  ([monitoring.md](../monitoring.md)).

### Phase 1: Audit log · M · built
- Spec `docs/specs/audit-service.md`; package `internal/audit` gains a read side
  (`List`, `Get`, `ForEntity`) and an event registry.
- Indexes; `request_id`, `session_id` and `source` columns.
- The missing events from 3.2 (users, item sets, employee and catalogue details).
- `audit.read`; the Audit log screen; History panels on Employee, Catalogue item, Order and
  User.

### Phase 2: Security · M
- ADR 0003; `auth_events`; `users.last_sign_in_at`; the sign-in limiter in Postgres.
- `security.read`; the Security screen: sign-in activity, active sessions across users (end
  one), and the access review.

### Phase 3: System and Overview · M
- Request IDs and error references; `error_events` and the client error reporter.
- `/metrics` on an internal port; the rolling 24-hour window.
- `system.read`; the System screen with Backups as a tab; the Overview with attention items.

### Phase 4: integrity and retention · M–L
- The `ppe_app` database role and grants; the TRUNCATE guard.
- `audit_seals`, the seal job and Verify.
- Retention settings, purge jobs; `audit.export` with CSV/JSONL.

### Phase 5: Usage · M
- Charts in `@ppe/ui/charts`; the Usage screen; `order.confirmation_link_opened` and the
  funnel; daily data-quality snapshot.

The Help text (`src/help/*.ts`), its screenshots and `docs/guide` will need an
Administration update after Phases 1–3. That is a separate request.

---

## 8. Open questions

1. **Retention:** is 10 years right for business audit events, and 180 days for sign-in
   records? This needs the accountant or legal adviser's answer.
2. **External services:** is an external uptime monitor acceptable (it only sees the public
   URL)? Grafana Cloud later (it would receive metrics)?
3. **Alerts:** who should be alerted, and how: email, Telegram or WhatsApp?
4. **Managers:** should managers see History on their records (proposed), and should a
   "Workwear auditor" role with only `audit.read` exist?
5. **Data sync:** can data-sync-ui move to importing through the API (3.2 option A)?

---

## References

- Code:
  - `internal/audit/audit.go`
  - migrations `0002_audit_events`, `0011_sync_user`, `0020_user_sessions` and
    `0022_roles_permissions`
  - `internal/domain/role/permission.go`
  - `cmd/api/login-limit.go`
  - `deploy/Caddyfile`
  - `docker-compose.prod.yml`
  - `web/apps/admin/src/lib/router.ts`
- Decisions: `docs/architecture/adr/0001-modular-monolith-with-bounded-contexts.md` (per-schema
  roles, outbox and worker, Postgres limiter, HR audit rules) and `0002-permissions-and-administration-app.md`.
- Practice:
  - OWASP Logging Cheat Sheet: which events to log and what never to log.
  - NIST SP 800-92: log management, retention and integrity.
  - ISO/IEC 27001:2022 Annex A 8.15 (logging), 8.16 (monitoring activities) and 5.18 (access
    rights review).
  - GDPR Art. 5(1)(c, e) (minimisation, storage limitation) and Art. 32 (security of
    processing).
