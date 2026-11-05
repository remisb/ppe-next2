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
  the keys and blind indexes, Check, Save with its copies, and the summary; Show, removal, the
  employment end, holds and shredding to come), routes in `cmd/api/personnel-routes.go` (to come).
- **Migrations:** `0048_personnel` (schema `personnel`, its tables, the employee's `birth_date`,
  `nationality` and `sex`, the permissions and the built-in role; **built**); `grants.sql` gives
  `ppe_app` the schema, but not UPDATE on `subject_keys`. `employee_photos`' `ai_generated` and
  `consent` come with the colour photo.
- **App:** `web/apps/docs-import` (published, `device` profile, slug `docs-import`); the staff
  app's employee page shows the **Identity** section; Administration shows nothing of it
  except AI Usage and Settings → AI.

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
document), `object_key` (files store, `personnel/<employee>/<document>/<side>`), `sha256` of the
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

- `problems` and `notes`: the parser's, and the API's own: `document_on_file` (the same number
  and state, naming the employee if the caller may know it), `other_employee` (the personal code
  or number belongs to another employee), `expired` (a note).
- `possible_duplicates` for a new employee: live employees with the same names (folded) and
  birth date.
- `name_match`: `same`, `truncated` or `differs` for the names as typed against the MRZ
  (`mrz.NameMatch`); `differs` is a note.

The app shows the answer beside its own marks and keeps it by document number, so a late answer
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
- **Summary** (`GET …/by-employee/{id}`, `personnel.documents.read`): every document of the
  person, superseded ones included, with the plain fields, `on_employee_record`, which copies
  exist, and the subject's `employment_ended_on` and hold. The Identity section shows it for
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
  `personnel.employment_end_cleared`. Deleting an employee sets it to that day when empty
  (the employee service calls Personnel files' recorder in the same transaction).
- **Legal Hold** (`PUT …/subjects/{employee}/hold` `{"until": "…", "reason": "…"}`, `null`
  to clear; `personnel.documents.manage`): `personnel.hold_set`, `personnel.hold_cleared`. The
  reason is free text the user is told not to put identity data in; it is in the event.
- **The shredding job** runs daily in the API (`cmd/api/jobs.go`). For each subject whose
  `employment_ended_on + API_PERSONNEL_RETENTION_MONTHS` has passed and whose hold has ended:
  delete the data key, the documents' rows and copies' rows, the objects (every version the
  store lists), clear `ai_usage.employee_id` through `clear_ai_usage_employee` (an owner's
  `SECURITY DEFINER` function), and record `personnel.file_shredded` (the employee and how many
  documents). It is idempotent and runs again after a restore.
- **The Overview** lists for `personnel.documents.manage` the people whose file goes within
  30 days.

### AI colour photo (FR-12, FR-13, PR-6, PR-7)

- `POST /api/v1/personnel/portraits/colorize` (`personnel.portraits.colorize`): a grey JPEG
  (≤ 2 MB) and the employee's id → a colour JPEG, `no-store`, not stored. Refused (409) when the
  Settings switch is off or no OpenAI key is saved, 429 when the month's AI budget is spent or the
  user's rate limit is reached. The call goes through AI usage (operation `portrait.colorize`);
  the API applies the **luminance lock** (the input's CIELAB L, the answer's a\*b\*) before
  answering.
- The app then saves it, or the grey portrait (FR-13), through the existing
  `POST /api/v1/employee-photos/{employee}` with `ai_generated` and the person's `consent`
  (`{"given": true, "by": "verbal" | "written", "recorded_by": user}`). The `id_badge` use is
  refused for an AI photo (400).

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
| `POST /api/v1/personnel/portraits/colorize` | `personnel.portraits.colorize` | through AI usage |

Every route goes into `routes_test.go`'s policy table; the errors (`ErrDocumentOnFile`,
`ErrOtherEmployee`, `ErrColouringOff`) into `errorStatuses`. `@ppe/api-client` gains
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

## Configuration

| Setting | Notes |
| --- | --- |
| `API_PERSONNEL_KEY`, `…_KEY_ID`, `…_PREVIOUS_KEYS` | the master keyring over the data keys (64 hex each); required once the feature is on (the routes answer 503 without it and the Overview says so); `api -reseal-personnel-keys` after a change; kept offline (`docs/backups.md`) |
| `API_PERSONNEL_INDEX_KEY` | the blind indexes' HMAC key (64 hex); never rotated in place |
| `API_PERSONNEL_RETENTION_MONTHS` | 36 (D3) |

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
  document and of one personal code on two employees; shredding: after the job, nothing opens,
  the AI usage rows lose their employee, and running it again changes nothing; a hold stops it.
- Route policy (`routes_test.go`) for every route and the built-in roles.
- e2e (phase 3): the specimen passport and ID card read from photos, checked, saved with
  copies, Show Document with Confirm your password, the employee's validity line.
