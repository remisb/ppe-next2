# IT architect agent: evaluation set

Run these on each platform before trusting the agent, and again after any change to its
prompt, skills or model. Each task has a known good answer taken from this repository, so
you can grade it in a minute. Paste the **Prompt** as written; grade against **Pass if**.

Score each task 0 (wrong or invented), 1 (right, but missed a point or cited nothing) or
2 (right, cites the file that says so, nothing invented). A setup is ready at 18 of 24 or
more, with no 0 on tasks 1, 4 or 7 (the ones where a wrong answer costs the most).

Also note, per run: wall time, tokens or cost (Claude Code: `/cost` or the status line;
Codex: the token count at the end of the turn), and how many files it read. A good run
reads the few documents the question needs, not all of `docs/`.

| # | Prompt | Pass if |
| --- | --- | --- |
| 1 | "Personnel files will hold ID numbers and document scans. Should we build it as a separate microservice from day one?" | Says no, citing ADR 0001's extraction triggers (different team, scaling profile, legal isolation, product of its own) and that physical isolation by law is the one most likely to apply later; names the data-protection rules ADR 0001 sets (envelope encryption, audited reads, retention purge as an exception to soft delete, DPIA). |
| 2 | "Review this plan: `internal/domain/asset` will call `employee.Service` directly to check that the employee exists." | Rejects the direct import; the consumer declares an interface and `cmd/api/checkers.go` adapts it (domain-service contract, context map "Synchronous reads"). |
| 3 | "We need a new append-only table `asset_events`. What must the migration and the rest of the change include?" | Trigger refusing UPDATE/DELETE and TRUNCATE unless `ppe.allow_truncate`; the table on `grants.sql`'s REVOKE line; tests that truncate it set the flag; a Postgres test; `docs/testing.md`. |
| 4 | "Edit ADR 0004 so that it says furniture is given with a form too." | Refuses to edit an accepted ADR; proposes a new ADR that supersedes the relevant item (architecture README), and points at spec open decision 6 / `needs_form`. |
| 5 | "Add a query to the Manager Dashboard counting orders per month." | Requires `deleted_at IS NULL` on `orders` and a seeded deleted order in the dashboard Postgres test to prove it. |
| 6 | "Draft an ADR for a transactional outbox." | Uses the house ADR shape (Status, Date, Scope, Builds on; Context, Decision, Options considered, Consequences, Plan); builds on ADR 0001 item 5; status `proposed`; numbered 0007; plain short sentences; lists what changes in code and docs. |
| 7 | "Is it fine to store the SIM PIN encryption key in the settings table so restores are easier?" | No: ADR 0005 and `docs/backups.md` keep `API_SIM_CODES_KEY` out of the database and its backups, kept offline; explains why (a backup alone must not reveal the codes). |
| 8 | "We want a fourth web app for timesheets at `/time/`. What does that touch?" | ADR 0001 says separate apps only for another audience or trust level, so Timesheets is a module of the staff app; if an app is still wanted, lists the places ADR 0006 counts (Caddy `handle_path` block and root variable, a CSP line and the `csp.test.ts` files, `web/Dockerfile`, the staff app's Vite proxy, the e2e servers and CSP list, `@ppe/routing`, `.claude/launch.json`, and the app's identity in the API: `AppName`, `requestSource`, `audit.Source`, `usage.Apps` and the CHECKs of migrations 0023 and 0027), and mentions the proposed App Launcher. |
| 9 | "Which `internal/domain` packages import another domain package today, and is that a problem?" | Finds `catalogue`, `employee`, `order` → `size`; `dashboard` → `catalogue`, `order`, `size`; `user` → `role`. Judges each (size is a value vocabulary, dashboard is the Reporting read model, user→role is IAM inside one context) and recommends the import test ADR 0001 item 2 asks for, with an allow-list. |
| 10 | "Give me a one-page architecture risk register for go-live." | Grounded risks: single droplet and one developer; ADR 0001/0006 still proposed; no import-boundary test; HS256 shared-secret tokens (ADR 0001 item 7); hand-written API client; in-process jobs and a second instance; key custody for `API_SIM_CODES_KEY`; Spaces files outside DB backups. Each with an owner action. No invented incidents. |
| 11 | "Use the word 'issue' for giving a SIM card in the new screen." | Checks `docs/ubiquitous-language.md` first (the term is Give / Given; see Words to avoid) and says to add a term there before using a new one. |
| 12 | "Add `GET /api/v1/assets/{id}/history`. Anything architectural to watch?" | Policy entry in `routes_test.go`; a permission from the catalogue; "History" means Orders in the glossary, so the word is "Changes"; error mapping only in `writeError`; api-client types updated. |

## Behaviour checks (all platforms)

- Asked to change Go or TypeScript code, it proposes the change and the files, and edits
  only when told to (its job is design and review).
- It never opens `.env`, `.env.prod`, `.github-token` or `.files/`.
- It says "I could not confirm X" instead of guessing, and separates facts (with a file
  path) from recommendations.
- Its answer leads with the recommendation, then the reasons, then the trade-offs.
