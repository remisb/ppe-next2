# Share service

**Share** (WARE-51, WARE-49) sends a few employees' details to someone outside the app,
from the Employees export sheet: **Copy as Text** (built in the browser, nothing stored) or
**Share Link**, a link that anyone who has it may open without signing in, until it
**expires** or its sharer **revokes** it on **Shared Links**. Unlike Export (Excel, CSV),
which needs **Export data** (`data.export`), sharing is everyone's: it holds at most
**10 rows** (`share.MaxRows`), and only what the sharer may see.

Package `internal/domain/share`, routes `cmd/api/share-routes.go`, migration 0060
(`shares`).

## A shared link

| Field | Rule |
| --- | --- |
| `kind` | what is shared: `employees` (the only kind) |
| `name` | 1–100 characters, the sharer's (the screen proposes the people's names) |
| `columns` | the export columns chosen, 1–50, each once; for employees the keys of `web/apps/workwear/src/lib/employee-export.ts` (`name`, `first_name`, `last_name`, `status`, `company`, `code`, `height`, `clothing`, `shoes`, `language`, `notes`, `birth_date`, `nationality`, `sex`, `added`) |
| `rows` | 1–10, one per employee, in the order chosen; the employees' ids are `subject_ids` (each once) |
| `days` | how long it is open: 1, 7 or 30 (`share.Durations`); `expires_at` is created + days |

**The rows are a snapshot.** The API builds them when the link is made, from each employee
as the sharer sees them (`employee.Sight`: no sizes without See employee sizes, no profile
without See employee profiles; the screen offers only those columns) and keeps only the
chosen columns' fields (`employeeShareFields`). Later changes to an employee do not reach
a link already made; the page says when it was shared.

**The link** is `<API_PUBLIC_BASE_URL>/shared/<token>`: 32 random bytes, base64url, shown
once in the answer to Share Link. Only its SHA-256 is stored (`token_hash`), as for
confirmation links (order service). The page sends the token in a request body
(`POST /api/v1/shares/view`), so no log line holds it.

**Erasing.** Revoking a link empties its rows at once (`rows = '[]'`, `erased_at`); the
API's hourly upkeep (`cmd/api/jobs.go`) does the same to every link that has expired
(`EraseExpired`, the System screen's last run counts them as `shares_erased`). The row stays,
with its name, columns, count and `subject_ids`, so who shared whose details remains known;
the details themselves do not.

## Use cases

- **Share Link** (`Create`): any signed-in user, for the employees they can read. Refuses
  more than 10 rows, an unknown kind or column, a repeated employee, other durations
  (`ErrInvalid`, 400); an employee that is not there is 404. Records `share.created`.
- **Shared Links** (`List`): the reader's own links that are still open (not revoked, not
  expired), newest first. Someone else's links are never listed.
- **Revoke** (`Revoke`): the sharer alone; another's link, or one already revoked or
  expired, is `ErrNotFound` (404). Records `share.revoked` and erases the rows.
- **Open** (`Open`, public): the link's name, kind, columns, rows, sharer's name, when it
  was shared and until when. An unknown token is 404; a revoked or expired one is
  `ErrGone` (410), and the page says the link is no longer available. Rate limited per
  client address, as confirmation links are (20 a minute).
- **Copy as Text** is the browser's alone (`@ppe/ui`'s `table-export.ts` `exportText`): the
  list's name and count, then each row as a block, its first column a heading and the others
  `Label: value` lines, empty values left out. Plain text, readable in an e-mail or a
  WhatsApp chat. Nothing is recorded.

## Routes

| Route | Access | Answer |
| --- | --- | --- |
| `POST /api/v1/shares` | any signed-in user | 201 `{share, url}` (`Cache-Control: no-store`) |
| `GET /api/v1/shares` | any signed-in user | 200 the reader's open links (a filter: `[]` when none) |
| `DELETE /api/v1/shares/{id}` | any signed-in user, their own | 204 |
| `POST /api/v1/shares/view` | public, `{token}` | 200 the link's view; 404; 410 |

`POST /api/v1/shares` body: `{"kind": "employees", "name": "…", "columns": ["name", …],
"ids": ["<employee id>", …], "days": 7}`.

## Audit

Area Employees, entity `share`, keyed by the link's id:

- `share.created`: after `{kind, name, columns, rows, subject_ids, expires_at}` (`rows` is
  the count; no employee's details).
- `share.revoked`: before `{name, expires_at}`.

Opening a link and its expiry are not events.

## Tests

`internal/domain/share/service_test.go` (rules, against a fake), `postgres_test.go` (the
table, erasing), `cmd/api/api_postgres_test.go`'s `TestPostgresSharesHTTP` (the snapshot follows
Sight and the columns, the public read, revoke, 404 and 410), the route policy, and the e2e step
"Employees: Share copies a few as text, or makes a link anyone opens until it is revoked on
Shared Links" (`docs/testing.md`).
