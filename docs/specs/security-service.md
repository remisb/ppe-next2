# Security service

The security log of sign-ins, and Administration's **Security** screen (`security.read`).
The screen has three tabs: sign-ins and failed attempts, every user's signed-in devices, and
the access review. This is phase 2 of
[admin/audit-analytics-monitoring.md](../admin/audit-analytics-monitoring.md). The decisions
are [ADR 0003](../architecture/adr/0003-audit-integrity-and-retention.md).

## What is recorded

`internal/security` is infrastructure, like `internal/audit`:

- The session repository calls `security.Insert` in the transaction that starts, refreshes
  or ends a session. Its `Mutation` returns the event beside the session (nil for none).
- The sign-in handlers record failures, which change nothing else, through
  `Service.Refused`.

Table `auth_events` (migration `0024`):

| Column | Notes |
| --- | --- |
| `kind` | `sign_in`, `sign_in_failed`, `reauth`, `reauth_failed`, `signed_out`, `session_ended`, `refresh_reused` |
| `user_id` | The account. NULL for an attempt at an email nobody has. FK to `users`, so `TRUNCATE users CASCADE` empties the table |
| `actor_user_id` | The signed-in user who made it happen, from the request's token: an administrator ending a session, or the user ending their other devices |
| `email_hash` | HMAC-SHA256 of the email typed (trimmed, lower-cased) under a key derived from `API_JWT_SECRET` (`securityConfig`). Never the email itself |
| `session_id` | The session concerned. No FK: ended sessions are deleted after 30 days |
| `reason` | Failures: `unknown_email`, `bad_password`, `inactive`, `too_many_attempts`. `session_ended`: the session's end reason (`ended_elsewhere`, `ended_by_administrator`, `password_changed`, `password_reset`, `deactivated`, `deleted`) |
| `ip`, `user_agent`, `request_id`, `source` | The request's (`audit.Request`, set by `requestContext`). NULL for work without a request (seeding, tests) |

Each case records the following:

| When | Kind | Written by |
| --- | --- | --- |
| Sign-in succeeds | `sign_in` with the email hash, plus `users.last_sign_in_at` | session `Create`, one transaction |
| Wrong password, unknown email, inactive account | `sign_in_failed` with the reason (`user.SignInRefused`) | `login` handler |
| The per-email limit refuses | `sign_in_failed` / `reauth_failed`, reason `too_many_attempts` (not counted by the limit) | `limited` |
| Password confirmed (reauth) | `reauth` with the email hash | session `Reauthenticated` |
| Wrong password at reauth | `reauth_failed`, `bad_password` | `reauth` handler |
| Sign out | `signed_out` | session `SignOut` |
| Signed out from another device, from Security, by a password change or reset, deactivation or deletion | `session_ended`, one per session | session `End`, `EndByAdministrator`, `EndAll` |
| A replaced refresh token comes back | `refresh_reused` (the session ends) | session `Refresh` |

A refresh that only rotates the token records nothing.

A trigger refuses every UPDATE. It refuses a DELETE unless the transaction has set
`ppe.purge_auth_events`, and refuses a row younger than 30 days even then.

## The per-email sign-in limit

`Service.Blocked(emailHash)` reads, newest first, at most `API_LOGIN_EMAIL_FAILURES` of
that email's failures with reasons `unknown_email`, `bad_password` or `inactive`. It counts
only failures within `API_LOGIN_EMAIL_INTERVAL` and after the email's last `sign_in` or
`reauth`. When there are that many, the email is refused until the oldest of them leaves the
interval. The answer is a 429 with `Retry-After`, recorded as `too_many_attempts`.

Login and reauth share the count (reauth uses the user's own email). The per-address limit
is middleware and stays in memory. Index: `auth_events_email_idx (email_hash, occurred_at DESC)`.

## Retention

- `API_AUTH_EVENTS_RETENTION`: default `4320h` (180 days), from `720h` to `26280h`.
- `purgeSecurityEvents` (`cmd/api/jobs.go`) deletes older rows when the API starts and then
  hourly. It holds `pg_try_advisory_xact_lock(hashtext('ppe.purge_auth_events'))`, so with
  several instances one purges, and logs `security events purged` with the count.
- `users.last_sign_in_at` outlives the events. Migration `0024` fills it from the sessions
  still kept.

## API

| Route | Permission | Notes |
| --- | --- | --- |
| `GET /api/v1/security/events` | `security.read` | The log, newest first, a page at a time |
| `GET /api/v1/security/sessions` | `security.read` | Every live user's live sessions, last used first |
| `DELETE /api/v1/security/sessions/{id}` | `users.manage` + recent sign-in | Ends a live session. The actor must be allowed to manage its user (`user.Service.MayManage`), as on Users, so 403 otherwise. 404 when it is not live |
| `GET /api/v1/security/access-review` | `security.read` | The review |
| `POST /api/v1/security/access-review` | `security.read` | Mark as reviewed: records `access_review.completed` on the audit trail and returns the review. It changes no access, so reading is enough |

**List:** `GET /api/v1/security/events?kind=&user=&from=&to=&after=&page_size=`.
- Its rules are the Audit log's: query parameters that combine.
- An unknown parameter, a repeated one, a malformed id or an unknown kind is 400.
- `from` and `to` are inclusive days in `API_ORG_TIMEZONE`.
- `page_size` is 1–200, default 50.
- Paging is keyset on `(occurred_at, id)` with the Audit log's cursor.
- An entry adds the account's and the actor's current name and email.
- `email_ref`, the first 8 hex digits of the email hash, tells attempts at different unknown
  emails apart.

**Access review:**
- One row per live user: name, email, active, created, last sign-in, live sessions, roles
  (id, key, name) and their permissions together (sorted).
- Flags:
  - `administrator`: holds the built-in Administrator.
  - `no_sign_in`: none recorded.
  - `dormant`: active, with no sign-in for `security.DormantAfter` (90 days). An account
    older than that with none recorded is dormant too.
- Also: `unused_roles`, the live roles no live user holds; `last_review` (when, by whom, and
  the audit event's id); `dormant_after_days`.
- Mark as reviewed records a summary of how many accounts carried each flag (`users`,
  `active_users`, `administrators`, `dormant`, `no_sign_in`). Area `security`, entity type
  `access_review`, with a fresh entity id for each review.

## Screen

**Administration → Security** (`/admin/security`, `web/apps/admin/src/routes/security.tsx`).
Each tab is its own address.

- **Sign-ins** (`/security?kind=&user=&from=&to=`):
  - Filters for event, person (with `users.read`), from and to.
  - The list shows when, the event and why, the account (or "Unknown account (ref)") and
    "by" whoever else did it, and where from: device, address and app.
  - A copied sign-in in view raises a warning that says what to do.
  - Older sign-ins load with Show older sign-ins.
- **Signed-in devices** (`/security/devices`):
  - Every live sign-in: who, device, address, Keep me signed in, last used and signed in.
  - **This device** is marked, by the token's `sid`.
  - Whoever holds `users.manage` has Sign out on the others, which asks for the password
    when the sign-in is not recent.
- **Access review** (`/security/review`):
  - The last review, linking to its change on the Audit log, with Mark as reviewed, and
    Open Users for whoever manages users.
  - The users with their roles, their permissions (folded), last sign-in, "Not used for 90
    days", and a filter to show only marked users.
  - The roles no one holds.

On a phone, Security is in the bar, and Roles & permissions and Settings move under More.

## Not here yet

- Seals, the least-privilege database role, the TRUNCATE guard, business-event retention
  and export (phase 4).
- Alerts on a failed-sign-in spike or a copied sign-in, and the Overview's reminder when the
  last review is over 90 days old (phase 3).
- The per-address limit in Postgres. It only slows one client, so it can stay per instance.
