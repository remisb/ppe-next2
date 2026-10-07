# Usage service

Administration's **Usage** screen (`usage.read`) shows:
- who uses the apps, and from what;
- how sign-ins and changes go over time;
- how far confirmation links get;
- how complete the data is.

This is phase 5 of
[admin/audit-analytics-monitoring.md](../admin/audit-analytics-monitoring.md) (section 4.1).
Business figures (orders, spend, replacements) stay on the staff app's Dashboards.

**No page is tracked.** Everything comes from what the API records anyway, so there is no
consent banner and no third party. The Content-Security-Policy would refuse an analytics
script in any case.

## What is recorded

`internal/usage` is infrastructure, like `internal/audit`.

**`user_activity(day, user_id, app)`** (migration 0027) records a user's app on a day.
- `observe` (`cmd/api/observe.go`) calls `usage.Service.Seen` for every request with a valid
  access token from an app: `workwear`, `admin` or `api` (the `X-PPE-App` header,
  `audit.Request.Source`).
- The day is in `API_ORG_TIMEZONE`.
- Each API process writes a user and app once a day; a repeat from another instance is
  ignored (`ON CONFLICT DO NOTHING`).
- This is how active people are counted. A sign-in lasts weeks, so sign-ins alone would
  undercount.
- The hourly upkeep deletes rows older than 400 days (`ActivityKept`).

**`data_quality_samples(day, …)`** holds the Dashboard's setup figures once a day, sampled
by the hourly upkeep (`dashboard.Service.Setup`, the Dashboard's own query; a later sample
the same day replaces it):
- employees;
- employees without sizes;
- active items;
- items without a price or service period;
- active item sets.

**`order_confirmations.first_opened_at`** is when the employee first opened a confirmation
link that was still waiting.
- `order.Service.RecordByToken` sets it.
- In the same transaction it records `order.confirmation_link_opened`, with no actor, on the
  order's Changes and the Audit log.
- Later openings record nothing (`LinkOpened` updates only an empty column).

## The report (`GET /api/v1/usage`, `usage.read`)

One read-only `REPEATABLE READ` transaction gives:

| Part | Span | Source |
| --- | --- | --- |
| `days` | the last 30 days, oldest first (`YYYY-MM-DD`, organisation timezone) | |
| `active.total`, `active.by_app` | per day | distinct people in `user_activity` |
| `active.by_role` | per day, every live role | the same, a person counted under each role they hold |
| `active.last_7`, `last_30`, `users` | | distinct people in 7 and 30 days, active accounts |
| `sign_ins`, `failed_sign_ins` | per day | `auth_events` `sign_in` and `sign_in_failed` |
| `devices` | last 30 days | `user_sessions` used since: User-Agent and the distinct people using it, at most 200; the app groups them into phone / tablet / computer, system and browser (`deviceName`) |
| `user_languages`, `employee_languages` | now | active users' interface language; live employees' preferred language, `""` for none |
| `weeks`, `changes` | 12 weeks from Monday | `audit_events` per area (`audit.AreaOf`) per week |
| `top_people` | last 30 days | the 8 who made the most changes |
| `funnel` | links created in the last 90 days, orders not deleted | sent, opened, confirmed; still waiting, expired unconfirmed, replaced (revoked by a newer link or a paper or in-person confirmation) |
| `quality` | last 90 days | the samples |

## Screen

**Administration → Usage** (`/admin/usage`, `web/apps/admin/src/routes/usage.tsx`):
- **Key figures:** active today, in the last 7 days and in the last 30 days (out of the
  active accounts), and sign-ins today with failures.
- **Active people per day:** bars per app, with a sparkline per role underneath.
- **Sign-ins per day:** signed in and failed.
- **Confirmation links:** the funnel as bars with shares of those sent, and the counts still
  waiting, expired and replaced.
- **Changes per week:** a heat strip per area, and the most active people.
- **Devices** (kinds, systems, browsers), **Languages** (users and employees), and **Data
  quality** (sparklines for employees without sizes and unpriced items).
- On a phone, Usage is under More.

The charts are `@ppe/ui/components/charts`: `BarChart` (also the Dashboards' month charts),
`Sparkline` and `HeatStrip`. They are plain elements and SVG, with no chart library. Each
puts its figures in a visually hidden table or an `aria-label`.
