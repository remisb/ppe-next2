# Vault service (Document Vault)

The organisation's documents, of fixed types: stored with their versions and files, linked to
the people and things they are about, found by search, and, for sealed types, kept for a period
and then shredded. Decisions in [ADR 0008](../architecture/adr/0008-document-vault.md); templates
and generation are [document-template-service.md](document-template-service.md); the queue and
worker are [outbox-service.md](outbox-service.md); the data-protection note is
[document-vault-dpia-note.md](../privacy/document-vault-dpia-note.md).

**Status: phase 1 built** (migration 0061, `internal/vault`, `internal/vault/document`,
`cmd/api/vault-routes.go`, `cmd/api/wire_vault.go`, the staff app's Document Vault and Documents
sections); the rest decided, not built. Each section names the phase that builds it (ADR 0008's
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
  (phase 5), `0066_document_template_docx` (phase 8).
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
| `retention` | `Keep` (until removed), `Forever`, `AfterDocDate(years)`, `AfterEmploymentEnd(months)` |
| `links` | the subject kinds it may be linked to, and which it must be (at least one employee, say) |
| `read`, `manage` | the permissions that let someone see it and change it |
| `origins` | `uploaded`, `generated`, `archived`: how a document of the type comes to be |
| `files` | accepted file types (sniffed) and the size limit |
| `fields` | the values generation may fill in (document-template-service.md) |
| `numbered` | gets a document number on generation, with its prefix (`EC-`) |

| Key | Group | Sealed | Retention (default) | Must link to | Read / manage | Origins | Phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `employee.certificate` | Employee | no | `AfterDocDate(10)` | employee | `vault.read` / `vault.manage` | uploaded | 1 |
| `employee.training` | Employee | no | `AfterDocDate(10)` | employee | `vault.read` / `vault.manage` | uploaded | 1 |
| `invoice` | Finance | no | `AfterDocDate(10)` | | `vault.read` / `vault.manage` | uploaded | 1 |
| `asset.document` | Company Assets | no | `Keep` | asset | `vault.read` / `vault.manage` | uploaded | 1 |
| `other` | Other | no | `Keep` | | `vault.read` / `vault.manage` | uploaded | 1 |
| `employment.contract` | Employment | yes | `AfterEmploymentEnd(120)` | employee | `vault.employment.read` / `vault.employment.manage` | generated, uploaded | 2 |
| `employment.annex` | Employment | yes | as its contract | employee; parent a contract | the same | generated, uploaded | 2 |
| `employment.nda` | Employment | yes | `AfterEmploymentEnd(120)` | employee | the same | generated, uploaded | 2 |
| `employment.other` | Employment | yes | `AfterEmploymentEnd(36)` | employee | the same | generated, uploaded | 2 |
| `asset.signed_form` | Company Assets | no | `Keep` | asset, employee | `vault.read` and the asset kind's read / the asset kind's manage (`sim_cards.manage`, `assets.manage`) | uploaded | 5 |
| `asset.assignment_form` | Company Assets | no | `Keep` | asset, employee | `vault.read` and the asset kind's read / none (archived only) | archived | 6 |
| `order.record` | Workwear | no | `Keep` | order, employee | `vault.read` (orders are every signed-in user's) / none (archived only) | archived | 6 |

The retention periods are defaults until the DPO answers (ADR 0008, open question 1); each is
a setting (`API_VAULT_RETENTION_<TYPE>`, months or years as the rule counts) so a change needs no
release. A Company Assets document also needs the asset kind's read permission (`sim_cards.read`
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
| `source_kind`, `source_id` | for archived and migrated documents (`asset_assignment`, `order`); UNIQUE together among all rows, so archiving twice is impossible |
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
  read-text row (`pending`, or `skipped`) and the event in one transaction; from phase 4 the
  same transaction enqueues `vault.extract_text`. A failed write may leave an unnamed object,
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
once by the next upkeep unless held; one that is not sealed keeps its objects (the bucket's
versioning and the type's retention decide).

### Get, Open, By subject (phase 1)

- `GET /api/v1/vault/documents/{id}`: the document, versions (newest first, with uploader
  names), files, links and read-text state. 404 when the reader lacks any of `requires`.
- `GET /api/v1/vault/documents/{id}/versions/{n}/file`: the main file as an attachment
  (`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private,
  no-store`; `writeAttachment`), read whole and checked against its SHA-256 before it is sent
  (a changed object is a 500, `ErrDamaged`). For a **sealed** type the route is `POST` and sensitive: a recent
  sign-in, the event `vault.document_opened` recorded before the answer.
- `GET /api/v1/vault/by-subject/{kind}/{id}`: the documents linked to a subject that the reader
  may see, newest first; from phase 7, an employee's identity documents too.

### Employee merge (phase 1)

`internal/domain/employee/postgres_merge.go` (`moveDocumentLinks`) moves the removed record's
`vault.links` (and `employee_id`) to the kept record in its transaction, names them as the kept
record is called, and rebuilds the documents' `search` (`vault.refresh_search`). A link that would
become a duplicate is dropped.

### Names change (phase 1)

When an employee, company, asset or supplier is renamed, the API's hourly upkeep
(`Service.RefreshLabels`, `cmd/api/jobs.go`) names every linked subject as it is called now and
rebuilds the search of the documents whose link changed; a subject that is gone keeps its last
name. Through the outbox once it exists (phase 4).

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
- ⌘K (phase 4) searches documents through the same route, at most 5 hits.

## Sealed types (phase 2)

- **Keys.** `API_VAULT_KEY` (64 hex), `…_KEY_ID`, `…_PREVIOUS_KEYS`, read in `loadConfig` and
  checked in `validate`. Optional: without it, creating, opening or generating a sealed type
  answers 503 `ErrNotConfigured`; listing and search show what is there.
  `api -reseal-vault-keys` re-seals the document keys under the current key. Kept offline
  (`docs/backups.md`).
- **What is sealed:** the title, the version's data and note, the files and their names. Plain:
  type, number, dates, links, sizes, hashes, retention.
- **Retention.** `retain_until` is computed from the type's rule: `AfterEmploymentEnd` reads the
  linked employee's employment periods through the `Employments` port (the end of the last one;
  null while one is open); `AfterDocDate` from `document_date`. An annex follows its contract.
  Recomputed when the employment changes (through the outbox, or the upkeep's daily pass).
- **Shredding.** The upkeep (`cmd/api/jobs.go`) calls `ShredDue`: for each document past
  `retain_until`, not held, it calls the owner's function `vault.shred_document(id)`, which
  deletes the key, versions' data, files' rows, read text and the vector, and sets
  `shredded_at`; then the objects are deleted (every version of them where the bucket keeps
  versions). Event `vault.document_shredded` (type, number, dates). Running it again changes
  nothing; after a restore it shreds again.
- **Legal Hold.** `PUT /api/v1/vault/documents/{id}/hold` with a date and reason (`manage`);
  events `vault.hold_set`, `vault.hold_cleared`. Held documents are never shredded or removed.
- **Overview:** documents that go within 30 days, for whoever may manage them.
- **Who sees them:** the built-in add-on role **Employment Documents** (fixed id, key
  `employment_documents`) holds `vault.employment.read` and `.manage`; no other built-in role,
  Administrator included.

## Identity documents (phase 7)

The port `IdentityDocuments.Of(ctx, employeeID, full bool)`, adapted over Personnel files'
`document.Service.Documents` when the reader has `personnel.documents.read`, else `Validity`.
By-subject answers for an employee, and search hits whose link labels name an employee (at most
10 employees), add their identity documents as rows of kind `identity` (kind, issuing state,
expiry, holder). They open `/employees/<id>/page#identity`; the vault offers nothing else.
Nothing of them is stored in the vault.

## Routes

| Route | Permission | Phase | Notes |
| --- | --- | --- | --- |
| `GET /api/v1/vault/types` | `vault.read` or `vault.employment.read` | 1 | the types the reader may see and add |
| `POST /api/v1/vault/search` | `vault.read` or `vault.employment.read` | 1 | `no-store` |
| `GET /api/v1/vault/by-subject/{kind}/{id}` | `vault.read` or `vault.employment.read` | 1 | |
| `POST /api/v1/vault/documents` | the type's `manage` | 1 | multipart; 400, 413, 415 |
| `GET /api/v1/vault/documents/{id}` | the type's `read` | 1 | |
| `PUT /api/v1/vault/documents/{id}` | the type's `manage` | 1 | |
| `DELETE /api/v1/vault/documents/{id}` | the type's `manage` | 1 | 409 locked or held |
| `POST /api/v1/vault/documents/{id}/versions` | the type's `manage` | 1 | multipart |
| `GET /api/v1/vault/documents/{id}/versions/{n}/file` | the type's `read` | 1 | attachment; types that are not sealed |
| `POST /api/v1/vault/documents/{id}/versions/{n}/file` | the type's `read`, recent sign-in | 2 | attachment; sealed types; recorded first |
| `PUT /api/v1/vault/documents/{id}/hold` | the type's `manage` | 2 | |
| `POST /api/v1/vault/documents/{id}/versions/{n}/read-again` | the type's `manage` | 4 | enqueues `vault.extract_text` |
| `GET /api/v1/vault/documents/{id}/verify` | the type's `read` | 6 | recomputes an archived copy's hash from its source |

Phase 1's routes need `vault.read` or `vault.manage` (`rt.restricted`): every phase 1 type names
them, and the service checks each document's type and links. From phase 2, routes whose
permission depends on the type become `rt.restrictedAny` over the read (or manage) permissions,
the type checked by the service (as Company Assets' kinds are). A document's Changes are
`GET /api/v1/audit-events/vault/{id}` (`vault.read`). Every route
goes into `routes_test.go`'s policy table, the errors into `errorStatuses` (`ErrNotFound` 404,
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

Migration `0065_vault_signed_copies`, pure SQL: each assignment with copies becomes a document
of type `asset.signed_form` (`source_kind` `asset_assignment`, `source_id` its id, links to the
asset and employee, locked); each copy becomes a version (`original`, then `added`) and a file
with **the same id**, object key, name, type, size, SHA-256, time and uploader; read text starts
`pending`. No object is copied. `asset_signed_copies` loses INSERT for `ppe_app` and is dropped a
release later.

Company Assets declares `SignedForms{Add, Of, Open, Holding}` (`internal/domain/asset/
signed_copy.go`): Upload Signed Form keeps its checks (an assignment with a form, the file's
type and size), then calls `Add`; the register's Documents column and `signed_copy=missing`
filter use `Holding`. Its routes, JSON and `signed-copies.tsx` do not change.
`api -vault-backfill [-commit]` checks, then moves, any copy written after the migration ran
(on the `-import-sims` pattern) and enqueues their reading.

## Archiving (phase 6)

After Give (an assignment with a form) and after a confirmation (an order becoming GIVEN), the
domain calls its `Archiver` after commit, which only enqueues `vault.archive` (best effort: no
Give or confirmation fails or changes because of it). The worker asks the vault's `Sources` port
for the PDF (`formpdf.Render`; `internal/recordpdf` for the Items Given Record, EN/RU, as
`components/receipt.tsx`), its hash (the domain's own document hash), title and links, and
stores an `archived` document; the unique source makes a second run a no-op. The upkeep's
`SweepArchives` finds anything missed (`asset.Service.FormsSince`, `order.Service.GivenSince`).
**Verify** recomputes the hash from the domain's snapshot and says whether the stored copy
matches.

## Configuration

| Setting | Phase | Notes |
| --- | --- | --- |
| `API_VAULT_KEY`, `…_KEY_ID`, `…_PREVIOUS_KEYS` | 2 | the master keyring over document keys (64 hex each); optional; kept offline |
| `API_VAULT_MAX_UPLOAD_MB` | 1 | 20; 1 to 100 |
| `API_VAULT_RETENTION_<TYPE>` | 2 | each type's period; the default the table above names |

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
  migration keeps ids, keys and hashes; `TestPostgresAPIRoleIsLeastPrivileged` extended.
- `internal/vault/imports_test.go`; `TestRoutePolicy`, `TestSeededRolesKeepPolicy`,
  `TestEveryDomainEventIsKnown`, `TestLoadConfigDefaults`.
- e2e: upload a certificate and find it by its unaccented name; the existing signed-copy steps
  pass unchanged after phase 5.
