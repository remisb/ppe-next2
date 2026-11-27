# Vault service (Document Vault)

The organisation's documents, of fixed types: stored with their versions and files, linked to
the people and things they are about, found by search, and, for sealed types, kept for a period
and then shredded. Decisions in [ADR 0008](../architecture/adr/0008-document-vault.md); templates
and generation are [document-template-service.md](document-template-service.md); the queue and
worker are [outbox-service.md](outbox-service.md); the data-protection note is
[document-vault-dpia-note.md](../privacy/document-vault-dpia-note.md).

**Status: phases 1 to 8 built** (migrations 0061 to 0067, `internal/vault`, `internal/vault/document`,
`internal/vault/extract`, `cmd/api/vault-routes.go`, `cmd/api/wire_vault.go`, the staff app's Document
Vault and Documents sections, Company Assets' signed copies kept here, assignment forms and Items Given
Records archived by the worker; ID documents listed from Personnel files; phases 6 and 7 needed no
migration); the rest decided, not built. Each section names the phase that builds it (ADR 0008's
plan: 1 core, 2 sealed types, 3 templates, 4 worker and text, 5 signed copies, 6 archiving, 7
identity documents, 8 DOCX).

- **Packages:** `internal/vault` (the type registry, `Types()`), `internal/vault/document`
  (entity, service, repository, Postgres; the five-file layout of `internal/domain/user`),
  `internal/vault/extract` (phase 4), `internal/sealbox` (gains `NewDataKey`/`OpenDataKey`,
  phase 2); routes in `cmd/api/vault-routes.go`, adapters in `cmd/api/wire_vault.go`;
  `@ppe/api-client`'s `vault`.
- **Isolation:** `internal/vault/...` imports no `internal/domain/*` or `internal/personnel/*`
  package (`internal/vault/imports_test.go`). It may import the platform: `internal/audit`,
  `internal/files`, `internal/sealbox`, `internal/outbox`, `internal/placeholder`.
- **Migrations:** `0061_vault` (phase 1), `0062_vault_sealed` (phase 2),
  `0063_document_templates` (phase 3), `0064_outbox` (phase 4), `0065_vault_signed_copies`
  (phase 5), `0066_vault_retention` (retention for every type), `0067_document_template_docx` (phase 8: DOCX
  templates, a generated version's DOCX source file, `vault.renders`).
- **Apps:** the staff app's **Document Vault** (`/vault`, list and detail at `/vault/<id>`) and a
  **Documents** section on the employee page and an asset's detail; Administration's **Document
  Templates** (phase 3).

Nothing a sealed document holds (its values, file names, read text) ever goes into an error, a
log line, an audit event, System's error list or a URL.

## Document types

A **document type** is fixed in code, `vault.Types()`, in the order screens list them, as Mail
Templates' use cases are. Administrators edit templates, never types. A type has:

| Part | Meaning |
| --- | --- |
| `key` | stable name, stored on the document (`employment.contract`) |
| `group` | how screens group types: Employee, Employment, Company Assets, Workwear, Finance, Other |
| `sealed` | files and data sealed with a data key per document (phase 2) |
| `retention` | `Keep` (until removed), `Forever`, `AfterDocDate(months)`, `AfterEmploymentEnd(months)`, `AfterSourceEnds(months)` (after the source's record ended: an assignment's return, an order's items' service period) |
| `links` | the subject kinds it may be linked to, and which it must be (at least one employee, say) |
| `read`, `manage` | the permissions that let someone see it and change it |
| `origins` | `uploaded`, `generated`, `archived`: how a document of the type comes to be |
| `files` | accepted file types (sniffed) and the size limit |
| `fields` | the values generation may fill in (document-template-service.md) |
| `numbered` | gets a document number on generation, with its prefix (`EC-`) |

| Key | Group | Sealed | Retention (Lithuania's minimum, VAD item) | Must link to | Read / manage | Origins | Phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `employee.certificate` | Employee | no | `AfterEmploymentEnd(36)` (VAD 2.2) | employee | `vault.read` / `vault.manage` | uploaded | 1 |
| `employee.training` | Employee | no | `AfterEmploymentEnd(36)` (VAD 2.2, 2.14, 2.23) | employee | `vault.read` / `vault.manage` | uploaded | 1 |
| `invoice` | Finance | no | `AfterDocDate(120)` (VAD 3.15; VAT Law art. 78) | | `vault.read` / `vault.manage` | uploaded | 1 |
| `asset.document` | Company Assets | no | `AfterDocDate(120)` (VAD 11.6) | asset | `vault.read` / `vault.manage` | uploaded | 1 |
| `other` | Other | no | `Keep` | | `vault.read` / `vault.manage` | uploaded | 1 |
| `employment.contract` | Employment | yes | `AfterEmploymentEnd(600)` (VAD 2.3) | employee | `vault.employment.read` / `vault.employment.manage` | uploaded; generated from phase 3 | 2 |
| `employment.annex` | Employment | yes | `AfterEmploymentEnd(600)` (VAD 2.3, as a contract) | employee (its contract as parent from phase 3) | the same | the same | 2 |
| `employment.nda` | Employment | yes | `AfterEmploymentEnd(600)` (VAD 2.3: an agreement on extra terms) | employee | the same | the same | 2 |
| `employment.other` | Employment | yes | `AfterEmploymentEnd(36)` (VAD 2.2) | employee | the same | the same | 2 |
| `asset.signed_form` | Company Assets | no | `AfterSourceEnds(120)`: the asset's return (VAD 11.6) | asset, employee | `vault.read` and the asset kind's read / none here: added by Company Assets' Upload Signed Form alone, with its permissions (`sim_cards.manage`, `assets.manage`) | uploaded (source `asset_signed_form`) | 5 |
| `asset.assignment_form` | Company Assets | no | `AfterSourceEnds(120)`: the asset's return (VAD 11.6) | asset, employee | `vault.read` and the asset kind's read / none (archived only) | archived | 6 |
| `order.record` | Workwear | no | `AfterSourceEnds(12)`: the end of the order's longest service period (VAD 2.30) | order, employee | `vault.read` (orders are every signed-in user's) / none (archived only) | archived | 6 |

The periods are Lithuania's minimum retention periods, from the national index for internal records
(*Vidaus administravimo dokumentų saugojimo terminų rodyklė*, "VAD", in force from 2024-10-01; it
replaced the general index), counted as the archives' rules count them, from 1 January of the year
after the rule's day; the DPO confirms them (ADR 0008, open question 1). The decisions and their
sources are the [document retention policy](../privacy/document-retention-policy.md). They are in code
(`vault.Types()`, `Type.Retention`), so a change is a release, and every type with a time rule is
shredded when due (Retention below); `other` is kept until removed. A Company Assets document also needs the asset kind's read permission (`sim_cards.read`
or `equipment.read`), so Equipment & Furniture's forms stay hidden as their assets are. Signed
copies are still uploaded and read through Company Assets' own routes with its permissions; the
vault's routes show them to readers who also have `vault.read`.

## Entities

### Document (`vault.documents`)

| Column | Notes |
| --- | --- |
| `id` | UUID |
| `type` | a key of `Types()` (CHECK by the service, not the database, so a new type needs no migration) |
| `title` | required, 1–200 characters; for a sealed type sealed in `data_sealed` and kept here as `''` |
| `number` | the document number, unique per type among live documents, for numbered types |
| `document_date`, `valid_from`, `valid_until` | optional dates; `valid_until` drives "expires" for certificates |
| `origin` | `uploaded`, `generated`, `archived` |
| `source_kind`, `source_id` | the record a sourced, archived or migrated document belongs to: `asset_signed_form` (an assignment's signed copies, phase 5), `asset_assignment` (its archived form, phase 6), `order`; UNIQUE together among all rows, so archiving twice is impossible |
| `parent_id` | an annex's contract |
| `template_id`, `template_version` | for generated documents (phase 3) |
| `sealed` | copied from the type when created |
| `requires` | `text[]`, the permissions a reader needs (all of them); GIN-indexed; set from the type and the links (an asset document of an equipment item requires `equipment.read`) |
| `type_words` | the type's names in English, Lithuanian and Russian (`vault.Type.Words`), for search |
| `search` | `tsvector`, weighted (Search below) |
| `retain_until` | computed from the type's rule (phase 2); null while it cannot be (employment not ended) or for `Keep`/`Forever` |
| `hold_until`, `hold_reason` | Legal Hold (phase 2) |
| `shredded_at` | set by shredding (phase 2); the row stays as a tombstone with type, number and dates only |
| `created_at`, `created_by_user_id`, `updated_at`, `updated_by_user_id`, `deleted_at`, `deleted_by_user_id` | soft delete as everywhere |

### Version (`vault.versions`)

Append-only (a trigger refuses UPDATE and DELETE except shredding's owner function; `ppe_app`
has neither). The newest is the document's current one.

| Column | Notes |
| --- | --- |
| `id`, `document_id`, `number` | `number` 1, 2, … per document, unique together |
| `origin` | `original` (the first upload), `generated`, `signed` (Upload Signed Copy), `archived`, `added` (a later upload) |
| `document_hash` | SHA-256: for generated and archived versions the canonical hash of their values or snapshot; for uploads the main file's SHA-256 |
| `data`, `data_sealed` | generated values (JSONB) for a document that is not sealed, or sealed bytes for one that is |
| `note` | optional, 500 characters; sealed with the data for a sealed type |
| `created_at`, `created_by_user_id` | |

### File (`vault.files`)

Append-only, as versions. A version has one **main** file (the document itself) and may have
more (phase 8: the DOCX a PDF was rendered from).

| Column | Notes |
| --- | --- |
| `id`, `version_id`, `role` | `main` or `source` |
| `object_key` | `vault/<document>/<file><ext>`; migrated signed copies keep their `signed-copies/…` key |
| `file_name` | the device's name, cleaned (`files.Name`), with the true extension; sealed for a sealed type |
| `content_type`, `size_bytes` | sniffed (`files.Sniff`), never the browser's |
| `sha256` | of the plaintext bytes, checked on opening |
| `sealed` | the object is sealed with the document's data key |
| `created_at`, `created_by_user_id` | |

### Link (`vault.links`)

What a document is about. `subject_kind` is one of `employee`, `company`, `employment`, `asset`,
`order`, `supplier`; `subject_id` is its id, checked through the `Subjects` port when the link is
made. `employee_id` is also set (a foreign key to `employees`, the shared kernel) for an employee
link, so a merge can move it. `label` is the subject's name (an employee's full name, a company's
or supplier's name, an asset's inventory number and name or phone number), for the list and
search; `requires` the permissions its kind needs (an equipment item's `equipment.read`). `locked`
links are set by generation, archiving or the migration and cannot be removed by a user. Primary
key (`document_id`, `subject_kind`, `subject_id`).

### Read text (`vault.version_text`, phase 4)

One row per version: `state` (`pending`, `reading`, `read`, `none` (no text found), `failed`,
`skipped` (a type or file that is not read)), `method` (`pdf_text`, `ocr`, `blocks`), `language`
(the script OCR chose), `pages`, `content` (the text, only for types that are not sealed, at most
1 MB), `tsv`, `read_at`, `error` (a code, never text from the file).

A generated version's row is `read` (`blocks`) at once; every other version's starts `pending`,
and the transaction that writes it enqueues `vault.extract_text` keyed by the version's id. The
worker's reading is [outbox-service.md](outbox-service.md), "Text reading". The document's pane
shows each version's state (*Waiting to be read*, *Reading*, *Read* with how and its pages, *No
text found*, *Couldn't read* with why, *Not read*) and **Read Again**.

### Document key (`vault.document_keys`, phase 2)

For a sealed document: its data key sealed by `API_VAULT_KEY` (`sealed_key`, `key_id`), bound to
the context `ppe.vault.document_key.v1|<document id>`. `ppe_app` may insert and delete, not update;
only re-sealing changes `key_id`, through an owner's function (as Personnel files' subject keys).
Its files are sealed with the context `ppe.vault.file.v1|<file id>` and its data with
`ppe.vault.data.v1|<version id>`.

## Rules

### Upload (phase 1)

`POST /api/v1/vault/documents`, multipart: the file, and a JSON part with type, title, dates,
links and an optional note.

- The type must have the `uploaded` origin and the reader the type's `manage` permission.
- The file's type is read from its first bytes (`files.Sniff`): PDF, JPEG, PNG, and from phase 8
  DOCX; each type may narrow it. At most 20 MB (a type may lower it): 413; anything else 415.
  Photos are cleaned (`files.Clean`), PDFs kept as sent.
- Links are checked: every kind the type requires is present, every id exists
  (`Subjects.Describe`), and the reader may see each (a hidden equipment item is 404 as
  elsewhere).
- The object is written first, then the document, version 1 (`original`), file, links, its
  read-text row (`pending`) and the event in one transaction; the same transaction enqueues
  `vault.extract_text`. A failed write may leave an unnamed object,
  which nothing reads.
- Event `vault.document_uploaded` (type, title for an unsealed type, file type, size, SHA-256,
  links).

### Add Version (phase 1), Upload Signed Copy (phase 3)

`POST /api/v1/vault/documents/{id}/versions`, multipart: a newer file of the same document
(`added`), or the signed copy of a generated one (`signed`, offered only for generated
documents). The earlier versions stay. Event `vault.version_added` (number, origin, file type,
size, SHA-256).

### Update (phase 1)

`PUT /api/v1/vault/documents/{id}`: title, dates and the links that are not locked, all replaced
(locked links stay whatever the body says). A type and a version's note never change. Events `vault.document_updated` (fields changed, names only for sealed
types) and `vault.document_linked` / `vault.document_unlinked`.

### Remove (phase 1)

`DELETE /api/v1/vault/documents/{id}` soft-deletes it (`manage`). Archived and migrated
documents cannot be removed (409 `ErrLocked`): their source owns them. A document under Legal
Hold cannot be removed. Event `vault.document_removed`. A sealed document removed is shredded at
once by the next upkeep unless held; one that is not sealed is shredded on its type's day, as if it
had stayed (`other` never: the bucket's versioning decides).

### Get, Open, By subject (phase 1)

- `GET /api/v1/vault/documents/{id}`: the document, versions (newest first, with uploader
  names), files, links and read-text state. 404 when the reader lacks any of `requires`.
- `GET /api/v1/vault/documents/{id}/versions/{n}/file`: the main file as an attachment
  (`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private,
  no-store`; `writeAttachment`), read whole and checked against its SHA-256 before it is sent
  (a changed object is a 500, `ErrDamaged`). For a **sealed** type the route is `POST` and sensitive: a recent
  sign-in, the event `vault.document_opened` recorded before the answer.
- `GET /api/v1/vault/by-subject/{kind}/{id}`: the documents linked to a subject that the reader
  may see, newest first. It lists no identity documents: the pages that use it (the employee's
  and an asset's Documents) sit beside the employee page's own Identity section; a search filtered
  by an employee lists them (Identity documents, phase 7).

### Employee merge (phase 1)

`internal/domain/employee/postgres_merge.go` (`moveDocumentLinks`) moves the removed record's
`vault.links` (and `employee_id`) to the kept record in its transaction, names them as the kept
record is called, and rebuilds the documents' `search` (`vault.refresh_search`). A link that would
become a duplicate is dropped.

### Names change (phase 1)

When an employee, company, asset or supplier is renamed, the API's hourly upkeep
(`Service.RefreshLabels`, `cmd/api/jobs.go`) names every linked subject as it is called now and
rebuilds the search of the documents whose link changed; a subject that is gone keeps its last
name. It stays in the upkeep, not the outbox: a rename is never urgent, and the hourly pass catches every one.

## Search (phase 1, read text from phase 4)

`POST /api/v1/vault/search` with `{query, types?, subject?, from?, to?, page}`. A POST so a
name searched for is never in a URL or the request log. `vault.read` or
`vault.employment.read`.

- **Configuration** `vault.ppe`: a copy of `simple` with `unaccent` (the immutable wrapper
  `vault.unaccent`), so *Žukauskaitė*, *zukauskaite* and *ŽUKAUSKAITĖ* match. No stemmer.
- **Vector** `documents.search`, rebuilt by `vault.refresh_search(id)` (SQL, migration 0061)
  after every change to a document, its links or its read text: **A** title, number, the type's
  names; **B** link labels; **C** file names (dates are filters, not words); **D** read text (every version's, the newest first, capped at 1 MB).
- **Query:** the words typed, each a prefix (`zukausk:*`), all required; ranked by
  `ts_rank_cd`, then the newest. When it finds nothing, a trigram fallback (`pg_trgm`,
  `word_similarity` of the words to the title and link labels, at least 0.45: *Zukauskiate* is
  0.58 of *Žukauskaitė*) finds near spellings, and the answer says `near`.
- **Filtering** in SQL: `requires <@ $reader_permissions`, `deleted_at IS NULL`,
  `shredded_at IS NULL`. Never filtered after the query, so counts and pages are right.
- **Answer:** pages of 50, each hit with type, title (or for a sealed type its type's name and
  number), links, dates, and a highlight from read text only for types that are not sealed
  (`ts_headline`).
- **Sealed types:** their read text is never kept; `IndexText` keeps only lexemes and drops every
  token with a digit (personal codes, account numbers, pay), so the vector cannot give them back.
- ⌘K searches documents through the same route (the words in the body) for whoever sees the
  vault, from 2 characters, at most 5 hits; near spellings are left to the vault's own search.

## Sealed types (phase 2)

Built (migration 0062, `internal/vault/document/sealed.go`).

- **Keys.** `API_VAULT_KEY` (64 hex), `…_KEY_ID`, `…_PREVIOUS_KEYS`, read in `loadConfig` and
  checked in `validate` (`vaultKeyErrors`: none of them another key here). Optional: without it,
  uploading, adding a version to or opening a sealed document answers 503 `ErrNotConfigured`;
  lists and search show what is there, named by type. Each document's data key
  (`sealbox.NewDataKey`) is sealed by the keyring in `vault.document_keys`, bound to the document;
  `ppe_app` may insert and delete a key, never change one. Kept offline (`docs/backups.md`).
  **To come:** `api -reseal-vault-keys`, for changing the key.
- **What is sealed:** the title (`title_sealed`; the plain `title` is empty), each version's note
  and file name (`versions.data_sealed`, JSON), and the files themselves (the stored file is named
  `document.<ext>`). Plain: type, number, dates, links and their names, sizes, hashes, retention.
  Reads open them when the keys are there (`Service.unseal`), so the document's page shows its
  title; lists and search name a sealed document by its type. Events never hold its title, file
  name or note (an edited title is `title_changed`).
- **Opening a file:** `GET …/versions/{n}/file` refuses a sealed document (409 `ErrSealed`);
  `POST …/versions/{n}/file` (`vault.employment.read`, `sensitive`: the user's roles as they are
  now and a recent sign-in, else Confirm your password) records `vault.document_opened` (type,
  version, file type, size, hash) before it opens the file, checks its hash and sends it.
- **Retention** (`retention.go`; since migration 0066 for every type with a time rule, not only
  sealed ones). The upkeep (`cmd/api/jobs.go`, hourly) calls `ShredDue`, which computes each such
  document's `retain_until` from its type's rule, 1 January of the year after the rule's day plus
  the months: `AfterEmploymentEnd` asks the `Employments` port (adapted over the employee's
  employment periods) when each linked employee's last period ended; while one is open, or the
  person was never employed or is not found, it is null. `AfterDocDate` counts from
  `document_date` (none: null). `AfterSourceEnds` asks the `Records` port's `Ended`: an
  assignment's returned date (its form and its signed copies; held, or marked Not Returned and
  never back: null), or a given order's date plus its longest line's service period.
- **Shredding.** A document past `retain_until`, or a sealed one removed, and not held, goes through the owner's
  function `vault.shred_document(id, at, day)` with `vault.document_shredded` (type, number,
  dates, whether removed; by no one) in one transaction: its key, versions, files, read text and
  links are deleted (the versions' and files' trigger allows it only there, under
  `ppe.vault_shred`), its title and search emptied and `shredded_at` set, the row kept as a
  tombstone (its source too, so a shredded record is never archived again); then
  its objects are deleted from the store. Reads and search leave shredded documents out. Running it
  again changes nothing; after a restore it shreds again. Removing a sealed document is a soft
  delete; the next upkeep shreds it unless it is held.
- **Legal Hold.** `PUT /api/v1/vault/documents/{id}/hold` with `hold_until` (today or later) and
  `hold_reason` (1–500), or `null` to clear it (the type's manage permission, or `vault.manage`
  for a type no one manages here: archived and sourced ones; only a type whose rule shreds, else
  400); events
  `vault.hold_set`, `vault.hold_cleared`. Until the day after `hold_until` a document is neither
  shredded (the SQL function refuses too) nor removed (409 `ErrHeld`).
- **Who sees them:** the built-in add-on role **Employment Documents** (`role.EmploymentID`
  `a0e1d000-0000-4000-8000-000000000007`, key `employment`) holds `vault.employment.read` and
  `.manage`; no other built-in role, Administrator included. A document's `requires` is
  `vault.employment.read`, so `vault.read` alone never shows one.
- **To come:** the Overview item for documents that go within 30 days.

## Identity documents (phase 7)

Personnel files keeps passports, ID cards and residence permits sealed per person (ADR 0007); the
vault lists them beside an employee's documents, **metadata only** (ADR 0008 decision 5).
Nothing of them is stored, opened or downloaded in the vault.

- **Port.** `IdentityDocuments.Of(ctx, employeeID, full bool)` (`internal/vault/document/identity.go`),
  adapted by `vaultIdentity` in `cmd/api/wire_vault.go` over Personnel files' `Documents`: in full
  (the reader holds `personnel.documents.read`, `vault.PermPersonnelRead`) every live document with
  its issue date and whether it is superseded; else the current ones' kind, issuing state and expiry
  only, what every signed-in user sees on the employee page (`Validity`). Never a number, name,
  personal code or copy.
- **Search.** `POST /api/v1/vault/search` answers `identity`: the ID documents of the employees the
  search is about, each with its holder (`IdentityRow`: id, employee id, holder, kind, issuing
  state, expiry, issue date and superseded in full). The employees are the subject it is filtered
  by, else, when it has words, those linked to its hits whose names the words match (every word
  begins a word of the name, case and accents aside, `NameMatches`), at most 10. Only on the first
  page and with no type filter; `total` does not count them; `[]` otherwise.
- **Staff app.** The Document Vault shows them above the list, **ID documents** (ⓘ: from
  Personnel files, metadata only): the holder, then "Passport · LTU · valid until …" (expired in
  the warning colour; **Superseded** in full). The holder opens `/employees/<id>/page#identity`,
  which scrolls to the Identity section (the documents for Personnel readers, else the validity
  line).
- By-subject lists none (above): the employee page has its own Identity section.

## Routes

| Route | Permission | Phase | Notes |
| --- | --- | --- | --- |
| `GET /api/v1/vault/types` | `vault.read` or `vault.employment.read` | 1 | the types the reader may see and add |
| `POST /api/v1/vault/search` | `vault.read` or `vault.employment.read` | 1 | `no-store`; `identity` from phase 7 |
| `GET /api/v1/vault/by-subject/{kind}/{id}` | `vault.read` or `vault.employment.read` | 1 | |
| `POST /api/v1/vault/documents` | the type's `manage` | 1 | multipart; 400, 413, 415 |
| `GET /api/v1/vault/documents/{id}` | the type's `read` | 1 | |
| `PUT /api/v1/vault/documents/{id}` | the type's `manage` | 1 | |
| `DELETE /api/v1/vault/documents/{id}` | the type's `manage` | 1 | 409 locked or held |
| `POST /api/v1/vault/documents/{id}/versions` | the type's `manage` | 1 | multipart |
| `GET /api/v1/vault/documents/{id}/versions/{n}/file` | the type's `read` | 1 | attachment; types that are not sealed |
| `POST /api/v1/vault/documents/{id}/versions/{n}/file` | the type's `read`, recent sign-in | 2 | attachment; sealed types; recorded first |
| `PUT /api/v1/vault/documents/{id}/hold` | the type's `manage` | 2 | |
| `POST /api/v1/vault/documents/{id}/versions/{n}/read-again` | the type's `manage` | 4 | 202; enqueues `vault.extract_text`; 400 for a generated version |
| `GET /api/v1/vault/documents/{id}/verify` | the type's `read` | 6 | recomputes an archived copy's hash from its source |

The routes are `rt.restrictedAny` over `vault.read`/`vault.employment.read` (reads) or
`vault.manage`/`vault.employment.manage` (changes), the service checking each document's type and
links; opening a sealed file is `rt.restricted` to `vault.employment.read` behind `sensitive`. A
document's Changes are `GET /api/v1/audit-events/vault/{id}`, for whoever may see it. Every route
goes into `routes_test.go`'s policy table, the errors are `apperr` kinds (`ErrNotFound` 404,
`ErrInvalid` 400, `ErrLocked` 409, `ErrHeld` 409, `ErrTooLarge` 413, `ErrFileType` 415,
`ErrNotConfigured` 503, `ErrNoStorage` 503).

## Permissions and roles

| Permission | Requires | Built-in roles | Phase |
| --- | --- | --- | --- |
| `vault.read` | | Administrator, Manager | 1 |
| `vault.manage` | `vault.read` | Administrator, Manager | 1 |
| `vault.employment.read` | | Employment Documents | 2 |
| `vault.employment.manage` | `vault.employment.read` | Employment Documents | 2 |
| `document_templates.manage` | | Administrator | 3 |

A new group, **Document Vault**, on Roles & permissions. `permission.go`, `builtin.go`,
`permissions.ts`, Administration's `roles.ts` (EN/LT/RU) and `TestSeededRolesKeepPolicy` follow.
Export of the list needs `data.export`, as every list's.

## Audit events

Area **Document Vault** (`vault`), entity type `vault_document`, entity id the document's; the
document's **Changes** (`GET /api/v1/audit-events/vault/{id}`, for whoever may see it). Links are
recorded as `links: [{kind, id, label}]` (upload, linked, unlinked), which Changes name. For sealed types no title, file name, value or
read text, only type, number, dates and sizes:

`vault.document_uploaded`, `vault.document_generated` (phase 3), `vault.document_archived`
(phase 6), `vault.version_added`, `vault.document_updated`, `vault.document_linked`,
`vault.document_unlinked`, `vault.document_removed`, `vault.document_opened` (sealed types,
phase 2), `vault.hold_set`, `vault.hold_cleared`, `vault.document_shredded` (phase 2). Each goes
into `audit.Events()` and `AUDIT_EVENTS`, their words into `@ppe/audit`.

Signed copies keep **their** event: an upload through Company Assets records
`asset.signed_copy_uploaded` on the asset, written by the vault in its transaction (phase 5).

## Signed copies (phase 5)

Company Assets' signed copies are kept here, its routes, JSON, event and `signed-copies.tsx`
unchanged. A type with a **source** (`vault.Type.Source`) is added by its source's context
alone, through its port: `asset.signed_form`'s source kind is `asset_signed_form`, its record
an assignment (not `asset_assignment`, which phase 6's archived form takes: the source is
unique). Its `manage` is empty, so no one changes such a document in the vault (Upload, Add
Version, Update, Remove are 403); its links are locked.

- **Company Assets** declares `SignedForms{Add, Of, Open, Holding}`
  (`internal/domain/asset/signed_copy.go`), adapted by `assetSignedForms` in
  `cmd/api/wire_vault.go`. Upload Signed Form keeps its checks (an assignment with a form, the
  file's type and size), then calls `Add`. The register's Documents column, the
  `signed_copy=missing` filter and the employee page's holdings use `Holding` (the assignments
  with a document, given to the register's query as an array); an asset's page reads its copies
  with `Of`, and a download opens one with `Open` (its SHA-256 checked).
- **The vault's side** (`internal/vault/document/source.go`): `AddSourced` stores the file
  first (`vault/<document>/<copy><ext>`), then, in one transaction, makes the assignment's
  document with the first copy (title `<inventory no.> · <given date>`, document date the
  given date, links to the asset and the employee, locked, named by Company Assets), adds the
  copy as the next version (`original`, then `added`) whose id and file's id are the copy's,
  its read text `pending` with its job, and the event Company Assets makes of the stored file
  (`asset.signed_copy_uploaded`); the vault records none of its own. `SourcedFiles`,
  `OpenSourced` and `Sources` answer the port's reads.
- **Migration `0065_vault_signed_copies`**, pure SQL, defines `vault.move_signed_copies()` and
  runs it: each assignment with copies becomes a document as above; each copy a version and a
  file with **the same id**, object key (`signed-copies/…`, no object copied), name, type,
  size, SHA-256, time and uploader; read text `pending`, a job for each. `asset_signed_copies`
  loses INSERT for `ppe_app` (`grants.sql`) and is dropped a release later with the function.
  Its down migration puts copies uploaded since back into `asset_signed_copies` and removes the
  documents.
- **`api -vault-backfill`** (`make prod-vault-backfill`) checks that every copy moved is in the
  vault with its id, key, size and hash and that each signed form's file is in the store with
  that hash, and counts the copies not moved yet (the previous release may write one while the
  migration deploys); with `-commit` it moves them through the same function.

## Archiving (phase 6)

A copy of each stored record is kept here, drawn from its domain's snapshot; the snapshot and
its hash stay in the domain, which stays the source of truth. Two types, each with a `Source`
and no `manage` (no one uploads, changes or removes one here; their links are locked):
`asset.assignment_form` (source `asset_assignment`, an assignment that stored a form) and
`order.record` (source `order`, a GIVEN order).

- **Queueing.** Give (an assignment with a form) and a confirmation that makes an order GIVEN
  call their domain's `Archiver` once their transaction has committed (`asset/archive.go`,
  `order/archive.go`; a repeated confirmation, which writes nothing, calls nothing). The adapter,
  `vaultArchiver` in `cmd/api/wire_vault.go`, only queues a `vault.archive` job keyed
  `<source>:<id>` (`document.Service.QueueArchives`: one statement, only for records with no
  document, a waiting job not doubled), best effort: a failure is logged with the ids alone, and
  Give or the confirmation answers as before.
- **The job** (`document.Service.Archive`, the worker's `archiveHandler`; no tool needed, only
  the files store). A record already archived is done at once. Otherwise the `Records` port
  (`vaultRecords`) gives the record: a form drawn by `formpdf.Render` from the stored form, an
  Items Given Record by `internal/recordpdf` (A4, English / Russian, as
  `components/receipt.tsx` prints it, its dates in the organisation's zone, the same bytes for
  the same record), the hash the domain stored (the form's; the confirmation's), title
  (`<inventory no.> · <given date>`; `<record no.> · <given date>`), number (an order's record
  number), document date and links (the asset and the employee; the order and the employee),
  and its maker (the giver). The PDF is stored first (`vault/<document>/<file>.pdf`), then one
  transaction writes the `archived` document under the giver, version 1 (`archived`, its
  `document_hash` the domain's), its read text pending with its job, and
  `vault.document_archived` with no actor (the worker did it; its after the type, number,
  hash, source and links). The unique source makes a second run, or a race, a no-op. A record
  with nothing to archive (gone, not given, no stored form) is done; one that is not a PDF,
  has no hash or misses a link fails for good (`outbox.Permanent`). A stored form that no
  longer matches its hash is refused and retried, then fails, and is on System's Worker card.
- **The sweep.** The API's hourly upkeep looks at the last 7 days' stored forms and given
  orders (`asset.Service.FormsSince`, `order.Service.GivenSince`) and queues those with no
  document (`sweepArchives`). `api -vault-backfill` reports how many of all of them have none
  and, with `-commit`, queues them: run once after deploying phase 6 for the records before it.
- **Verify** (`GET /api/v1/vault/documents/{id}/verify`, the type's read; `no-store`):
  `document_hash` (the archived version's), `source_hash` (computed again now from the
  domain's stored snapshot: the form encoded again, the receipt built again from the order),
  `matches`, `file_intact` (the kept file still hashes to its SHA-256), `source_gone`. 400 for a
  document that is not archived. The staff app's document pane has **Verify** on such a
  document, with **Matches** or **Does not match**.
- The Items Given Record also downloads as this PDF: `GET /api/v1/orders/{id}/record.pdf`
  (anyone signed in, as the record; Download PDF on the record page).

## Configuration

| Setting | Phase | Notes |
| --- | --- | --- |
| `API_VAULT_KEY`, `…_KEY_ID`, `…_PREVIOUS_KEYS` | 2 | the master keyring over document keys (64 hex each); optional; kept offline |


The upload limit (20 MB, `vault.MaxUploadBytes`) and the retention periods are in code.

The files store is the existing `API_FILES_TARGET`; without it uploads are 503 `ErrNoStorage`.
Worker settings are in [outbox-service.md](outbox-service.md).

## Tests

- Service tests against a fake repository and store: required links, type and size refusals,
  `requires` from links, locked links and archived documents refuse changes, a sealed type's
  events hold no title or value.
- Postgres tests: triggers refuse UPDATE/DELETE on versions and files; the unique source;
  unaccented prefix search and the trigram fallback; `requires` filtering (an equipment document
  invisible without `equipment.read`); merge moves links; seal round trip; shredding leaves
  nothing that opens and running it again changes nothing; a hold stops it; the signed-copy
  migration keeps ids, keys and hashes (`TestPostgresSignedCopiesMove`), and uploads through
  Company Assets land in the vault (`TestPostgresAssetsSignedCopyHTTP`);
  `TestPostgresAPIRoleIsLeastPrivileged` extended; archiving: Give and a paper confirmation
  each queue one job, the worker's handler keeps each record once as ppe_app, linked and named
  as its source, Verify matches, the record drawn again is the archived bytes, and the sweep and
  the backfill find what was never queued, once (`TestPostgresArchiveHTTP`,
  `TestPostgresArchiveSweep`).
- `internal/vault/imports_test.go`; `TestRoutePolicy`, `TestSeededRolesKeepPolicy`,
  `TestEveryDomainEventIsKnown`, `TestLoadConfigDefaults`.
- e2e: upload a certificate and find it by its unaccented name; the existing signed-copy steps
  pass unchanged after phase 5.
