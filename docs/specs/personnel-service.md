# Personnel service

Personnel files' first part: a person's **identity documents** (passports, ID cards and
residence permits), read by the docs-import app and kept sealed per person, how long they are
kept, and the AI colour photo made from a document's portrait. Decisions in
[ADR 0007](../architecture/adr/0007-personnel-files-identity-documents.md); requirements,
reasoning and phases in the [docs-import plan](../apps/docs-import-plan.md) (FR-, NFR- and PR-
numbers below are its). AI usage, through which the colour photo's call goes, is
[ai-usage-service.md](ai-usage-service.md).

- **Packages:** `internal/personnel/mrz` (the MRZ parser, **built**), `internal/personnel/document`
  (entity, service, repository, Postgres; the five-file layout of `internal/domain/user`; **built:**
  the keys and blind indexes, Check, Save with its copies, the summary and validity, Show Document
  and its copies, Add to Employee Record later, Remove, the retention, Mark Employment Ended, Legal
  Hold and the shredding; `file.go`, `postgres_file.go`), `internal/personnel/colour` (the AI colour
  photo, **built**), `internal/personnel/scan` (kept scans, **built**), routes in
  `cmd/api/personnel-routes.go`, `cmd/api/personnel-scan-routes.go` and, for colouring,
  `cmd/api/ai-routes.go` (**built**), `@ppe/api-client`'s `personnel`. **To come:** the Overview
  item, `api -reseal-personnel-keys` and deleting every version of a shredded object.
- **Keys:** optional. Without `API_PERSONNEL_KEY` and `API_PERSONNEL_INDEX_KEY` (both or neither,
  `config.personnelKeyErrors`) Check, Save and Show Document and its copies answer 503 and nothing
  is kept; the summary, validity and the file's other actions work on what is there. A 409 says `conflict` (`document_on_file`, `other_employee`) and
  `existing_id`; a 400 for the MRZ lists `problems` as codes and fields.
- **Migrations:** `0048_personnel` (schema `personnel`, its tables, the employee's `birth_date`,
  `nationality` and `sex`, the permissions and the built-in role; **built**); `grants.sql` gives
  `ppe_app` the schema, but not UPDATE on `subject_keys`. `0051_ai_usage` adds `employee_photos`'
  `ai_generated` and `consent` (with the colour photo; **built**). `0053_personnel_scans` adds
  `personnel.scans` (kept scans; `ppe_app` may not UPDATE it; **built**).
- **App:** `web/apps/docs-import` (published, `device` profile, slug `docs-import`; **built**); the staff
  app's employee page shows the **Identity** section (`components/identity-section.tsx`, its rules
  `lib/identity.ts`; **built**): the validity line for everyone, the documents and Show Document for
  `personnel.documents.read` (those added to the employee record; every one for
  `personnel.documents.manage`, with Add to / Take Off Employee Record, Remove, Mark Employment Ended
  and Legal Hold); Administration shows nothing of it except AI Usage and Settings → AI.

Nothing read from a document ever goes into an error, a log line, an audit event, System's
error list or a URL. Problems are codes with a field's name (`@ppe/mrz`'s and
`internal/personnel/mrz`'s). PR-2's no-leak test holds every route to it.

## Entities

### Subject (`personnel.subjects`, `personnel.subject_keys`)

The person as Personnel files sees them: one per employee who has, or had, a document.

| Field | Notes |
| --- | --- |
| `employee_id` | primary key, foreign key to `employees` (the shared kernel) |
| `personal_index` | HMAC blind index of the personal code; unique, so one personal code is one person |
| `employment_ended_on` | the date retention runs from (Mark Employment Ended); null while employed |
| `hold_until`, `hold_reason` | a Legal Hold: the shredding job leaves the person alone until the date |
| data key | in `subject_keys`: 32 random bytes, sealed by `API_PERSONNEL_KEY`'s keyring, bound to `"ppe.personnel.subject_key.v1\|" + employee id`, with its `key_id`. Created with the person's first document; deleting it is the shredding |

### Identity Document (`personnel.identity_documents`)

| Field | Stored | Notes |
| --- | --- | --- |
| `id` | plain | |
| `employee_id` | plain | the subject |
| `kind` | plain | `passport`, `id_card` or `residence_permit` (from the MRZ's document code and the user's choice of Passport or ID card) |
| `issuing_state` | plain | ICAO code (`LTU`) |
| `issued_on` | plain, nullable | typed in the review (not in the MRZ), or later read from the printed page (FR-16) |
| `expires_on` | plain | from the MRZ |
| `on_employee_record` | plain | **Add to Employee Record**, chosen at the scan |
| `sealed` | sealed | `{number, personal_code, mrz: [lines], birth_date, nationality, sex, surname, given_names (as printed, with diacritics), place_of_birth, authority}` with the subject's data key, bound to `"ppe.personnel.document.v1\|" + document id` |
| `number_index` | plain | HMAC blind index of the number; unique with `issuing_state` among live documents |
| `superseded_at` | plain | set when a later document of the same kind is saved for the person |
| created, deleted | plain | the usual actor columns; removal is a soft delete |

`personal_index` lives on the subject, not the document: the same code on another employee is
refused there.

### Document Copy (`personnel.document_copies`)

One image per side: `page` (a passport's data page), `front` and `back` (a card's), and
`portrait` (the crop the photo is made from). Columns: `document_id`, `side` (unique per
document), `object_key` (files store, `personnel/<employee>/<document>/<side>-<copy id>`), `sha256` of the
plain JPEG (checked when opened), `bytes`, created. The object is the JPEG sealed with the
subject's data key, bound to `"ppe.personnel.copy.v1\|" + copy id`: the store holds nothing
readable, and bucket versioning's old versions are unreadable once the key goes.

### On the employee (People)

`employees` gains `birth_date`, `nationality` (ICAO code) and `sex` (`M`, `F`, `X`), nullable,
filled only from a document saved with Add to Employee Record on, and only the fields the user
chose to take (FR-8). `employee_photos` gains `ai_generated` and `consent` (who, when, how).

## Rules

### Check (FR-9)

`POST /api/v1/personnel/documents/check` re-parses the lines with `internal/personnel/mrz`
(today in the organisation's timezone) and answers, writing nothing:

- `valid`, `problems`, `notes` and `needs_second_read`: the parser's (`expired` is one of its
  notes).
- `document_on_file`: the live document with the same number and issuing state, as
  `{employee_id, document_id}`; `other_employee`: the employee the personal code belongs to, when
  not the chosen one. Neither names the number or code.
- `possible_duplicates` for a new employee: up to five live employees with the same first and
  last name, or the same last name and birth date (ignoring case).
- `name_match`: `same`, `truncated` or `differs` for the names as typed against the MRZ
  (`mrz.NameMatch`); `differs` is a note.

The answer is `no-store`. The app shows it beside its own marks and keeps it by document number, so a late answer
for an earlier reading is dropped (Scan SIMs' `registeredOf` pattern).

### Save (FR-10, FR-19)

`POST /api/v1/personnel/documents`, multipart: a `document` JSON part and the images.

```jsonc
{
  "employee": {"id": "…"} /* or */ {"new": {"first_name": "…", "last_name": "…", "code": "…"}},
  "mrz": ["…", "…"],                 // the lines, as reviewed
  "kind": "passport",
  "surname": "Žukauskaitė", "given_names": "Miglė",   // as printed, with diacritics
  "issued_on": "2021-03-04", "place_of_birth": "Vilnius", "authority": "…",   // optional
  "add_to_employee_record": true,
  "take": ["birth_date", "nationality", "sex", "names"]   // FR-8: the fields to write to the employee
}
```

Parts `copy_page`, or `copy_front` and `copy_back`, and `portrait`: JPEG, at most 5 MB each,
checked by content (magic bytes and a decode), at most 2400 px on the long side; anything else
is 415 or 413.

1. The lines are parsed again; any problem refuses the save (400, the problems as codes).
   `needsSecondRead` is the app's business, not the API's: the lines it sends have been read
   twice.
2. Blind indexes are computed; a live document with the same number and state is 409
   (`DuplicateError`, naming the document), the same personal code on another employee is 409
   (naming the other employee). Both are also caught by the unique indexes when two saves race.
3. The objects are sealed and written first, under new ids. Then one transaction: the employee
   created (D6) or locked `FOR UPDATE`; the subject created with its data key if new; an earlier
   live document of the same kind marked superseded; the document and its copies' rows written;
   with Add to Employee Record on, the `take` fields written to the employee (`employee.updated`
   records the names and that birth date, nationality or sex changed, never their values);
   the events. If the transaction fails, the new objects are deleted.
4. The answer is the document's summary (below), never a sealed value.

### Summary, Identity section and Show Document (FR-14, FR-15, D11)

- **Validity** (`GET …/by-employee/{id}/validity`, any signed-in user): per live, unsuperseded
  document, `kind`, `issuing_state`, `expires_on`; the "ID card · LTU · valid until 2029-04-12"
  line every employee page may show. Other contexts may learn this much (the context map).
- **Summary** (`GET …/by-employee/{id}`, `personnel.documents.read`, `no-store`): every live
  document of the person, superseded ones included, current ones first, with the plain fields,
  `on_employee_record` and which copies exist; the retention is `GET …/subjects/{employee}`. The Identity section shows it for
  documents added to the employee record; holders of `personnel.documents.manage` see all.
- **Show Document** (`POST …/documents/{id}/show`, `personnel.documents.read`, a recent
  sign-in): the sealed fields. `personnel.document_shown` is recorded first, the answer is
  `no-store`, and the app hides it again after 60 s or when the tab is hidden. Place of birth
  and issuing authority are sealed (D2), so they open here, not with the page.
- **Show a copy** (`POST …/documents/{id}/copies/{side}/show`, the same rules): the JPEG,
  opened with the subject's key and checked against its `sha256`; the event names the side.

### Add to Employee Record later

`PUT …/documents/{id}/employee-record` `{"on": bool}` (`personnel.documents.manage`): changes
the choice and records `personnel.document_updated`. Turning it on does not write the
employee's columns; that takes a new scan or the employee form.

### Remove a document

`DELETE …/documents/{id}` (`personnel.documents.manage`): soft delete, its objects deleted,
`personnel.document_removed`. The sealed row and the objects' older versions can still be
opened with the person's key until it goes (retention); the screen says so.

### Employment end, retention and Legal Hold (D3, D10, FR-20)

- **Mark Employment Ended** (`PUT …/subjects/{employee}/employment-ended` `{"on": "2026-11-30"}`,
  `null` to clear; `personnel.documents.manage`): `personnel.employment_ended` and
  `personnel.employment_end_cleared`. A deleted employee without one counts as ended on the day of
  the deletion: the shredding job's query reads it (`coalesce(employment_ended_on, deleted_at)`),
  so the employee service needs no call into Personnel files. A person without a personnel file
  has nothing to end (404). `GET …/subjects/{employee}` (`personnel.documents.read`) reads the file's
  retention.
- **Legal Hold** (`PUT …/subjects/{employee}/hold` `{"until": "…", "reason": "…"}`, `null`
  to clear; `personnel.documents.manage`): `personnel.hold_set`, `personnel.hold_cleared`. The
  reason is free text the user is told not to put identity data in; it is in the event.
- **The shredding job** runs with the API's hourly upkeep (`cmd/api/jobs.go`, `ShredDue`). For each
  subject whose end of employment `+ API_PERSONNEL_RETENTION_MONTHS` has passed and whose hold has
  ended: delete the data key, the documents' and copies' rows and the subject (hard deletes, the one
  exception to soft delete, PR-8), then the objects' current versions, and record
  `personnel.file_shredded` with no actor (the job's, as the audit purge's), the number of documents
  and the period. It is idempotent and runs again after a restore. Still to come: deleting the
  objects' older versions (they cannot be opened without the key). A shredded person's AI usage
  calls keep their cost and lose their employee (`aiusage.PostgresStore.ClearEmployee`, after the
  shredding commits; a failure is logged).
- **The Overview** (to come) is to list for `personnel.documents.manage` the people whose file goes
  within 30 days.

### AI colour photo (FR-12, FR-13, PR-6, PR-7)

- `POST /api/v1/personnel/portraits/colorize` (`personnel.portraits.colorize`): a grey JPEG
  (≤ 2 MB) and the employee's id → a colour JPEG, `no-store`, not stored. Refused (409) when the
  Settings switch is off or no OpenAI key is saved, 429 when the month's AI budget is spent or the
  user's rate limit is reached. The call goes through AI usage (operation `portrait.colorize`);
  the API applies the **luminance lock** (the input's CIELAB L, the answer's a\*b\*) before
  answering.
- The app then saves it, or the grey portrait (FR-13), through the existing
  `POST /api/v1/employee-photos/{employee}` with `ai_generated=true` and the person's `consent`
  (`verbal` or `written`), kept as `{by, recorded_by_user_id, at}` (the uploader, the upload's
  time). The `id_badge` use is refused for an AI photo (400); details in
  [employee-service.md](employee-service.md), "Photos".

### Kept scans (ADR 0007 amendment)

Import Documents' **Scan Document** keeps one person's flattened document pages as a zip for the
user who made it, `API_PERSONNEL_SCAN_DAYS` (3) days, so the work need not be done again.
`internal/personnel/scan`, table `personnel.scans` (migration 0053).

- **Keep** (`POST /api/v1/personnel/scans`, multipart: a `scan` part, JSON
  `{"surname", "given_names", "kind", "number", "mrz"?}`, and the pages in order as `page-1` …
  `page-10`; read through `MaxBytesReader`, 10 × 5 MB + 256 KB). Each page is a JPEG of at most
  5 MB and 2400 px (`document.CheckJPEG`, `document.MaxCopySize`/`MaxCopySide`), 1 to 10 of them
  (400 none, 413 more or too large, 415 not a JPEG). `kind` is `passport`, `id_card` or
  `residence_permit`; the surname is required and must hold a letter; the number is letters and
  digits (upper-cased) or empty. The MRZ lines, when sent, are re-read by
  `internal/personnel/mrz`: they must be a document's MRZ and its code must match the kind (a
  reading with problems is still kept); they are never kept.
- **The zip** holds `page-01.jpg` … in the order sent, stored (no compression), dated 1980-01-01,
  so the same pages make the same zip. Its **file name** is `<Surname>_<Given>_<kind>.zip`: spaces
  as one underscore, letters (diacritics kept), digits and hyphens kept, everything else left out;
  no given names, no part; kind words `passport`, `id-card`, `residence-permit`.
- **Sealing:** a fresh data key per scan (`document.Keys.NewDataKey`, context
  `ppe.personnel.scan_key.v1|<id>`), sealed by the master keyring with its `key_id`; the zip
  (`…scan.v1|<id>`) and the meta, the file name included (`…scan_meta.v1|<id>`), sealed with it.
  The object goes to `personnel-scans/{id}` first, then the row with `personnel.scan_kept`; a
  failed row deletes the object. The row keeps the plain zip's `bytes` and `sha256`.
- **List** (`GET /api/v1/personnel/scans`): the caller's own scans not expired, newest first,
  their meta opened: `id`, `file_name`, `surname`, `given_names`, `kind`, `number`, `pages`,
  `bytes`, `created_at`, `expires_at`; `[]` when none.
- **Download Archive** (`GET /api/v1/personnel/scans/{id}/archive`): `application/zip`, the file
  name in `Content-Disposition` alone (RFC 2231 `filename*` for a name beyond ASCII), `no-store`.
  The zip's SHA-256 and size are checked (500 when they differ); `personnel.scan_downloaded` is
  recorded before the answer.
- **Remove** (`DELETE /api/v1/personnel/scans/{id}`, 204): deletes the row (and so the key) with
  `personnel.scan_removed`, then the object.
- **Only the uploader:** another user's scan, or an expired one, is 404 on download and remove,
  and absent from the list, whatever their permissions.
- **Expiry:** the upkeep (`cmd/api/jobs.go`, `scan.Service.PurgeExpired`, `JobRun.scans_purged`)
  hard-deletes every row whose `expires_at` has passed, then their objects, best effort (logged).
  No event: the expiry was known when the scan was kept. It runs again after a restore.
- Without Personnel files' keys or a files store every route answers 503.

## Routes

| Route | Permission | Notes |
| --- | --- | --- |
| `POST /api/v1/personnel/documents/check` | `personnel.documents.manage` | writes nothing |
| `POST /api/v1/personnel/documents` | `personnel.documents.manage` | multipart; 400 problems, 409 duplicate, 413, 415 |
| `GET /api/v1/personnel/documents/by-employee/{id}/validity` | any signed-in user | kind, state, expiry |
| `GET /api/v1/personnel/documents/by-employee/{id}` | `personnel.documents.read` | the summary |
| `POST /api/v1/personnel/documents/{id}/show` | `personnel.documents.read`, recent sign-in | sealed fields; `no-store` |
| `POST /api/v1/personnel/documents/{id}/copies/{side}/show` | `personnel.documents.read`, recent sign-in | the JPEG; `no-store` |
| `PUT /api/v1/personnel/documents/{id}/employee-record` | `personnel.documents.manage` | |
| `DELETE /api/v1/personnel/documents/{id}` | `personnel.documents.manage` | |
| `PUT /api/v1/personnel/subjects/{employee}/employment-ended` | `personnel.documents.manage` | |
| `PUT /api/v1/personnel/subjects/{employee}/hold` | `personnel.documents.manage` | |
| `GET /api/v1/personnel/subjects/{employee}` | `personnel.documents.read` | the retention; 404 without a file |
| `GET /api/v1/personnel/portraits/colorize` | `personnel.portraits.colorize` | `{available}`: whether to offer Make Colour Photo (AI) |
| `POST /api/v1/personnel/portraits/colorize` | `personnel.portraits.colorize` | through AI usage |
| `POST /api/v1/personnel/scans` | `personnel.documents.manage` | multipart; 400, 413, 415; `no-store` |
| `GET /api/v1/personnel/scans` | `personnel.documents.manage` | the caller's own; `no-store` |
| `GET /api/v1/personnel/scans/{id}/archive` | `personnel.documents.manage` | the zip; the caller's own; `no-store` |
| `DELETE /api/v1/personnel/scans/{id}` | `personnel.documents.manage` | the caller's own |

Every route goes into `routes_test.go`'s policy table; the errors into `errorStatuses`
(`document.ErrDuplicate` 409 for either `DuplicateError`, `ErrEmployeeCodeTaken` 409,
`ErrCopyTooLarge` 413, `ErrCopyNotJPEG` 415, `ErrNotConfigured` 503; `colour.ErrOff` 409,
`ErrTooOften` 429, `ErrNotPortrait` 415; `scan.ErrNotFound` 404, `ErrTooManyPages` and
`ErrPageTooLarge` 413, `ErrPageNotJPEG` 415, `ErrNotConfigured` 503). `@ppe/api-client` gains
`personnel.*`. The app sends `X-PPE-App: docs-import`.

## Permissions and role

| Permission | Requires | Built-in roles |
| --- | --- | --- |
| `personnel.documents.read` | | Personnel Documents |
| `personnel.documents.manage` | `personnel.documents.read` | Personnel Documents |
| `personnel.portraits.colorize` | `personnel.documents.manage` | none (an administrator adds it) |

A new group, **Personnel files**, on Roles & permissions. The built-in **Personnel Documents**
role (fixed id `a0e1d000-0000-4000-8000-000000000006`, key `personnel`) is installed by the
migration and `role.EnsureBuiltins`; no other built-in role, Administrator included, gets these
permissions (as Equipment Assignments). `permissions.ts` and `TestSeededRolesKeepPolicy` follow.

## Audit events

On the employee's Changes and the Audit log, with the document's kind, issuing state and dates,
never a number, code, name from the document or image:

`personnel.document_recorded` (and how many copies, `on_employee_record`),
`personnel.document_superseded`, `personnel.document_updated`, `personnel.document_shown` (what:
`fields` or a copy's side), `personnel.document_removed`, `personnel.employment_ended`,
`personnel.employment_end_cleared`, `personnel.hold_set`, `personnel.hold_cleared`,
`personnel.file_shredded`; `employee.photo_added` gains `ai_generated`. Each name goes into
`audit.Events()` and `AUDIT_EVENTS`.

Kept scans' events are on the scan (entity type `personnel_scan`, the Employees area), with its
id and page count (`pages`) only: `personnel.scan_kept` (and `expires_at`),
`personnel.scan_downloaded`, `personnel.scan_removed`.

## Configuration

| Setting | Notes |
| --- | --- |
| `API_PERSONNEL_KEY`, `…_KEY_ID`, `…_PREVIOUS_KEYS` | the master keyring over the data keys (64 hex each); optional: without it (and the index key) Check, Save and Show Document and its copies answer 503; `api -reseal-personnel-keys` after a change is to come; kept offline (`docs/backups.md`) |
| `API_PERSONNEL_INDEX_KEY` | the blind indexes' HMAC key (64 hex); never rotated in place |
| `API_PERSONNEL_RETENTION_MONTHS` | 36 (D3); 12 to 1200, always checked |
| `API_PERSONNEL_SCAN_DAYS` | 3; how long a kept scan stays, 1 to 14 (checked with the keys) |

Each is read in `loadConfig` and checked in `validate`. AI settings are in
[ai-usage-service.md](ai-usage-service.md).

## Tests

- `internal/personnel/mrz`: `testdata/mrz/vectors.json`, shared with `@ppe/mrz` (built).
- Service tests with a fake repository and a fake store: a save's events hold no sealed value
  (PR-2, the same way the SIM codes tests do); a second document supersedes; `other_employee`
  through the blind index; Add to Employee Record writes only the `take` fields; a copy that is
  not a JPEG is refused.
- Postgres tests: the schema and grants (`ppe_app` may insert and delete `subject_keys` rows but
  not update them, and only re-sealing changes `key_id`, through an owner's function;
  `TestPostgresAPIRoleIsLeastPrivileged`); two concurrent saves of one
  document and of one personal code on two employees; shredding: after the job, nothing opens
  and running it again changes nothing; a hold stops it (`TestPostgresShowRemoveAndShred`).
  `ClearEmployee` is `aiusage`'s Postgres test.
- Kept scans: `internal/personnel/scan`'s service tests (keep, list only one's own, expired ones
  hidden, open and its event, remove, the purge, the page limits and a non-JPEG, a changed object
  refused, the object deleted when the row fails, the file name, the same zip for the same pages)
  and Postgres tests (`TestPostgresKeepListOpenRemovePurge`, `ppe_app` may not update a row);
  `TestPostgresPersonnelScansHTTP` keeps, lists, downloads and compares the zip with the pages,
  another user's 404s, the events without a name or number.
- Route policy (`routes_test.go`) for every route and the built-in roles.
- e2e (phase 3): the specimen passport and ID card read from photos, checked, saved with
  copies, Show Document with Confirm your password, the employee's validity line.
