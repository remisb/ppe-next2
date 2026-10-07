# ADR 0003: Security events apart from the audit trail, and how long each is kept

- **Status:** accepted (items 1–3 built in phase 2, items 4–5 in phase 4)
- **Date:** 2026-10-07
- **Scope:** backend (Go API, Postgres), deployment
- **Builds on:** [ADR 0001](0001-modular-monolith-with-bounded-contexts.md) (the sign-in
  limiter must survive a second API instance), [ADR 0002](0002-permissions-and-administration-app.md),
  and the proposal [admin/audit-analytics-monitoring.md](../../admin/audit-analytics-monitoring.md),
  sections 3.4–3.6

## Context

`audit_events` records every business change and is append-only. Administration also needs
sign-ins: who signed in, from where, the failed attempts, stolen refresh cookies, and who
ended whose session. These rows differ from business changes in four ways:

- **Volume.** Every failed attempt is one, and a guessing attack makes thousands.
- **Personal data.** Each needs the client's address and browser, which business changes
  deliberately leave out (phase 1 keeps them on the session only).
- **Unknown accounts.** A failed sign-in for an email nobody has names no record.
- **Lifetime.** They matter for months, not for the years accounting records are kept.

The per-email sign-in limiter also counted failures in the API's memory. A restart forgot
them, and ADR 0001 needs it shared before a second API instance runs.

## Decision

1. **A separate table, `auth_events`** (migration 0024), not more event names in
   `audit_events`.
   - It records kinds `sign_in`, `sign_in_failed`, `reauth`, `reauth_failed`, `signed_out`,
     `session_ended` and `refresh_reused`. Each row holds the account when one matched, the
     session, a reason, the address, the browser, the request ID and the app.
   - A failed attempt stores the email it named only as a **keyed hash** (HMAC-SHA256 under a
     key derived from `API_JWT_SECRET`). Repeated attempts at one address group together, but
     the address typed is never stored, nor is a password.
   - Rows about a session are written in the transaction that changes the session
     (`internal/security.Insert`, as `audit.Insert`). Failures, which change nothing else,
     are written on their own.
2. **The per-email limiter counts `auth_events` rows**, so it holds across restarts and
   instances. The rule is unchanged: after `API_LOGIN_EMAIL_FAILURES` failures within
   `API_LOGIN_EMAIL_INTERVAL` since the last success, that email is refused until the
   oldest of them leaves the window. The per-address limit stays in memory; it only slows one
   client and is cheap to lose.
3. **Security events are kept 180 days** by default (`API_AUTH_EVENTS_RETENTION`, 30 days to
   3 years). That is long enough to investigate an incident, while addresses are personal
   data that GDPR says to keep no longer than needed.
   - The setting is configuration, never a screen. A retention control in the UI would let
     one compromised administrator account erase the record of its own sign-ins.
   - The API deletes older rows hourly, under a Postgres advisory lock, so one instance
     does it.
   - A trigger refuses every UPDATE. It refuses a DELETE unless the transaction sets
     `ppe.purge_auth_events`, and refuses any row younger than 30 days even then.
   - `users.last_sign_in_at` keeps the last sign-in beyond the retention for the access
     review.
4. **Business audit events are kept 10 years** (`API_AUDIT_RETENTION`, 1–20 years), pending
   the accountant's confirmation. That is how long Lithuanian accounting documents are
   commonly kept, and orders and receipts are such documents.
   - **Daily seals** (`audit_seals`): each UTC day's events are hashed and chained to the
     day before, an hour after the day ends.
   - **Verify** recomputes them, hourly and on demand.
   - **The purge** deletes whole sealed days only, and records itself (`audit_purges`, an
     `audit.purged` event).
   - **Export** is a permission of its own (`audit.export`), and each export is an audit
     event.
5. **Least privilege.** The API connects as `ppe_app`.
   - It may only INSERT and SELECT the trails (`audit_events`, `auth_events`,
     `audit_seals`, `audit_purges`, `order_lines`), and may truncate or alter nothing.
   - The purges run through `SECURITY DEFINER` functions owned by the owner, which refuse
     recent rows (365 and 30 days).
   - Migrations, backups and restores keep the owner role.
   - A statement trigger refuses TRUNCATE on the trails unless the transaction sets
     `ppe.allow_truncate`.
   - The grants live in `internal/db/grants.sql`, applied on every migrate. A restore
     (`pg_restore --no-acl`) drops them, and the next migrate restores them.

## Consequences

- The Audit log and the Security screen are separate lists. The Security screen reads
  `auth_events`, all live sessions and the access review, under `security.read`.
- The access review's **Mark as reviewed** is a business decision, so it is an audit event
  (`access_review.completed`), kept with the others.
- Personal data rule for new events: record IDs and field names. Record values only where
  the value is the business fact (a price, a size, a status). Never record passwords, notes
  text or ID numbers.
- Tests that `TRUNCATE users CASCADE` empty `auth_events` too, through its foreign key to
  `users`. They set `ppe.allow_truncate` first, and empty `audit_seals` and `audit_purges`
  by name, which no cascade reaches. The API's Postgres tests and the e2e suite connect as
  `ppe_app`, so its grants are exercised; setup keeps the owner.
- Until production sets `API_DB_USER=ppe_app` and `API_DB_PASSWORD`, the API connects as
  the owner, and the Overview says so.
- A seal cannot catch a change made within the hour's grace before its day is sealed, or a
  rewrite of the whole chain by someone holding the owner's password. Seals anchored outside
  the database (proposal 3.5 C) would.
- Removing the in-memory limiter means each sign-in costs one more indexed query
  (`auth_events_email_idx`).
