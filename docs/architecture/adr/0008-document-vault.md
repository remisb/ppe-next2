# ADR 0008: Document Vault, typed documents, templates and search

- **Status:** accepted (decisions made 2026-11-24); not built. Phase 0 (this record, the specs and
  the terms) is done; phases 1 to 8 follow, one pull request each
- **Date:** 2026-11-24
- **Scope:** backend (Go API, Postgres, files store, a worker), frontend (the staff app's Document
  Vault and the employee page, Administration's Document Templates), deployment (`.env.prod`, a
  worker container)
- **Builds on:** [ADR 0001](0001-modular-monolith-with-bounded-contexts.md) and the
  [context map](../context-map.md) (contexts, the outbox, adapters in the composition root),
  [ADR 0002](0002-permissions-and-administration-app.md) (a permission per action),
  [ADR 0003](0003-audit-integrity-and-retention.md) (the audit trail is permanent, event names
  never change), [ADR 0004](0004-company-assets.md) (assignment forms and signed copies),
  [ADR 0007](0007-personnel-files-identity-documents.md) (sealing per subject, retention,
  crypto-shredding, Legal Hold)
- **Spec:** [vault-service.md](../../specs/vault-service.md),
  [document-template-service.md](../../specs/document-template-service.md) and
  [outbox-service.md](../../specs/outbox-service.md); the data-protection note is
  [document-vault-dpia-note.md](../../privacy/document-vault-dpia-note.md)

## Context

The ask: one place that stores the organisation's documents, of different types; fills
**document templates** with data to make new documents (employment contracts first); and makes
every document **findable**, including the text of what was uploaded.

What the app has today, four ways of keeping something document-like:

| What | Kept as | Searchable |
| --- | --- | --- |
| Items Given Record (Workwear) | a snapshot on the order and its lines, with a SHA-256 document hash; printed by the browser, no file kept | no |
| Assignment form (Company Assets) | a JSONB snapshot with a hash; drawn as a PDF by pdf-mini (`internal/formpdf`) each time it is asked for | no |
| Signed copies, employee photos | uploads in the files store (`internal/files`), rows in `asset_signed_copies`, `employee_photos` | no |
| Identity documents (Personnel files) | sealed per person under `API_PERSONNEL_KEY`, copies in the files store | blind indexes only |

There is no full-text search, `pg_trgm` or `unaccent` in the database, no queue or worker, and
the only templates are Mail Templates (`{{field}}` placeholders, one per use case, not versioned).

What shapes it:

- **Contracts are personal data with a legal clock.** An employment contract holds the
  person's name, personal code, pay and terms; Lithuanian law keeps it for a period after
  employment ends. It needs the treatment Personnel files gave identity documents: sealed,
  kept for a period, then made unreadable.
- **The existing records must not change.** An Items Given Record's and an assignment form's
  hash is computed from their snapshots; the sealed audit trail's event names never change
  (ADR 0003). Whatever the vault does with them, the domains keep their snapshots and hashes.
- **Personnel files is finished and isolated** (ADR 0007): nothing else reads its tables.
- **OCR and PDF text need tools** (Tesseract, Poppler, later LibreOffice) that the API's
  `scratch` image cannot hold, and that should not run inside a request.
- **The droplet is small.** Whatever runs beside the API must fit in its memory.

## Decision

1. **A Document Vault context.** Package `internal/vault` (parts `document`, `template`,
   `extract`, later `docx`), schema `vault`, permissions `vault.*`, audit area `vault` (entity
   type `vault_document`). It imports no `internal/domain/*` or `internal/personnel/*` package;
   an architecture test (`internal/vault/imports_test.go`) fails the build when it does. What it
   needs from other contexts it declares as ports, adapted in `cmd/api/wire_vault.go`.

2. **Document types are fixed in code.** `vault.Types()` lists them, as Mail Templates' use
   cases: each type names whether it is **sealed**, its retention rule, the subjects it may and
   must be linked to, its read and manage permissions, its fields, its origins (uploaded,
   generated, archived), its file types and size limit. Administrators edit templates, never
   types. The first types: `employee.certificate`, `employee.training`, `invoice`,
   `asset.document`, `other` (phase 1); `employment.contract`, `employment.annex`,
   `employment.nda`, `employment.other` (phase 2, sealed); `asset.signed_form` (phase 5);
   `asset.assignment_form`, `order.record` (phase 6).

3. **A document is a row with versions, files and links.** `vault.documents` (type, title,
   number, dates, origin, a unique source `source_kind`/`source_id`, an optional parent for an
   annex, template and version, sealed, the permissions a reader needs `requires`, the search
   vector, retention and hold, soft delete); `vault.versions` and `vault.files`, both
   append-only; `vault.links` to **subjects** (employee, company, employment, asset, order,
   supplier) by kind and id, only `employee_id` a foreign key (the shared kernel), links set by
   generation or archiving **locked**; `vault.version_text` for what was read from a file.
   Files are in the files store under `vault/<document>/<file><ext>`, written before the rows.

4. **Sealed types: a data key per document, retention, crypto-shredding.** A sealed type's
   files and data are sealed (`internal/sealbox`, AES-256-GCM) with a fresh **data key** of the
   document, itself sealed by a new master keyring, `API_VAULT_KEY` (`…_KEY_ID`,
   `…_PREVIOUS_KEYS`, `api -reseal-vault-keys`). Optional: without it, sealed types answer 503
   and the rest works. A type's retention rule is one of: after employment ends, after
   the document's date, after its source's record ended (months each, counted from 1 January
   after), forever, or kept until removed; since 2026-11-25 it applies to every type, sealed or not. The API's hourly upkeep shreds
   what is due (the key, the objects and the rows go, `vault.document_shredded` stays); a
   **Legal Hold** stops it; the Overview lists what goes within 30 days. Employment documents get their own
   add-on role, **Employment Documents** (`vault.employment.read`, `.manage`), which
   administrators do not get by default, as with Personnel Documents. The envelope helper is
   copied from Personnel files into `internal/sealbox`; Personnel files may move to it later.

5. **Personnel files is not refactored; identity documents are linked, metadata only.** Its
   code, schema, routes and events stay. The vault declares an `IdentityDocuments` port,
   adapted over Personnel files' own `Documents`/`Validity`, and shows an employee's identity
   documents beside the vault's own: kind, issuing state, expiry, holder, and a link to the
   employee page's **Identity** section. The vault never stores, opens or downloads them.

6. **Document templates, edited in the app, made into locked PDFs.** A **document template**
   belongs to one type and is a document of blocks (`ppe.blocks.v1`: headings, paragraphs,
   lists, tables, fields, signatures, page breaks; bold and italic; `{{field}}` placeholders; no
   HTML, no logic), edited in Administration's **Document Templates**
   (`document_templates.manage`) and **published** as an immutable version; one draft at a time.
   Its fields are the type's (`employee.*`, `company.*`, `employment.*`, `document.*`,
   `user.name`, `today`) and **asked fields** it declares (`input.<key>`: text, long text, date,
   number, money, choice). The placeholder parser moves out of Mail Templates into
   `internal/placeholder`, which both use. `internal/docpdf` draws a version on pdf-mini,
   deterministically, with the footer *Document <number> v<n> · SHA-256 <hash>*. Uploaded DOCX
   templates come later (phase 8) and are converted by LibreOffice in the worker.

7. **Generate is preview, then generate, with a hash.** **Generate Document…** previews with
   *PREVIEW* in the footer and answers a `values_hash`; Generate refuses a stale hash (409, as
   Give's form hash does), gives the document its **document number**, hashes the canonical JSON
   of {type, template id, version and body hash, number, date, values} into the version's
   document hash, draws, seals and stores version 1, and links it (locked) to the employee and
   company. The event names the document, never a value. **Upload Signed Copy** adds a version.

8. **Search in Postgres.** Full-text search with a configuration of our own, `vault.ppe`
   (`simple` with `unaccent`; no Lithuanian stemmer exists), prefix matching, weights (A title,
   number, type; B linked names; C file names and dates; D read text) and a `pg_trgm` fallback on
   titles and names. Results are filtered in SQL by `requires <@` the reader's permissions.
   Searching is a POST (`/api/v1/vault/search`), so a name searched for is never in a URL or a
   log line. For sealed types no read text is kept, only its lexemes, without tokens holding
   digits; shredding deletes them.

9. **A worker, fed by a Postgres queue.** A platform **outbox** (`internal/outbox`, schema
   `outbox`): jobs written in the transaction that causes them, claimed with
   `FOR UPDATE SKIP LOCKED` under a lease, retried with back-off, woken by `LISTEN/NOTIFY` with
   a 10 s poll behind it. The worker is the API's own binary (`api -worker`) in a second image,
   **docworker** (Debian slim with Tesseract `eng`, `lit`, `rus`, `osd` and Poppler; LibreOffice
   in phase 8), run read-only with a tmpfs, a memory limit and no capabilities. It reads text
   (`pdftotext`, else OCR of the pages), archives records and renders DOCX. The API image stays
   `scratch`. System shows the worker; the Overview warns when it is silent or jobs fail.

10. **The existing records move in, their domains unchanged.** *Signed copies*: their storage
    moves into the vault (type `asset.signed_form`, one document per assignment, each copy a
    version with **the same id**, object key and hash, migrated in SQL without copying an
    object); Company Assets reaches it through a `SignedForms` port, and the same event,
    `asset.signed_copy_uploaded`, is recorded; its routes, JSON and screens do not change, and
    `asset_signed_copies` is frozen, then dropped a release later. *Assignment forms and Items
    Given Records*: after Give and after a confirmation, a job archives their PDF in the vault
    (`internal/recordpdf` draws the record); their snapshots and hashes stay in their domains,
    and the vault can **verify** a copy against them. Employee photos stay where they are.

## Consequences

- **One more key to keep offline.** `API_VAULT_KEY` joins `API_SIM_CODES_KEY` and Personnel
  files' keys: a restore needs it, `docs/backups.md` says how to keep and change it. Losing it
  loses every sealed document.
- **Two database extensions.** `unaccent` and `pg_trgm` must be allowed wherever the database
  runs (they are in the official Postgres image); the restore drill restores them.
- **A second container and more memory.** About +150 MB of image and up to 300 MB of memory
  with Tesseract, and about +500 MB and 300 MB more with LibreOffice in phase 8; measured on the
  droplet before each goes live. Without the worker, uploads still work and their text is read
  when it comes back.
- **Text read from scans is in the database and its backups.** For types that are not sealed,
  the text itself; for sealed ones, lexemes without digits. The DPIA note says so, and the
  shredding removes them with the document.
- **The vault learns names.** Link labels and search vectors hold employees' and companies'
  names, kept fresh when they change (a rename, a merge); a merge moves the vault's links in its
  own transaction.
- **Two copies of the envelope helper** (Personnel files' and `internal/sealbox`'s) until
  Personnel files moves to the shared one.
- **No Lithuanian stemming.** `simple` with `unaccent` and prefixes finds *Žukauskaitė* by
  *zukausk*, but not one form of a word by another; measured once there is real text.
- **The context map gains a context and an exception**: the vault reads Personnel files'
  metadata through a port, as the employee page already does through its API.

## Alternatives considered

- **Moving Personnel files' documents into the vault.** One store for everything, but it would
  reopen a finished, audited design and widen who can reach identity data. Rejected for now:
  linked, metadata only (decision 5).
- **A search engine (Meilisearch, OpenSearch).** Better ranking and stemming, but another
  service to run, back up and secure on a small droplet, and a second copy of personal data.
  Postgres full-text search is enough for thousands of documents.
- **OCR in the browser, as the scanning apps do.** Fine for a phone's photo, not for a 40-page
  PDF uploaded on a desktop, and it would make every client a reader. The worker reads once.
- **OCR inside the API.** Its image is `scratch`, and a long OCR in a request ties up memory
  the API needs. Rejected for a worker on a queue.
- **HTML templates printed by a headless browser.** Flexible, but Chromium is larger than
  LibreOffice, and HTML templates invite logic and scripts. The block model draws with the
  PDF library the app already uses.
- **Archiving records by copying their tables into the vault.** The snapshots already exist in
  their domains; a PDF and a link to the source is enough, and the hash proves the copy.

## Open questions

1. **Retention per type**: set to Lithuania's minimum periods (2026-11-25; the national index
   for internal records, "VAD", in force from 2024-10-01): contracts, annexes and NDAs 50 years
   after employment ends, other employment papers, certificates and training 3, invoices and
   asset papers 10, Items Given Records 1 after the items' service period; every type with a
   period is shredded when due, not only sealed ones (`vault-service.md`, "Document types").
   The DPO confirms them, and whether anything is kept longer for a stated reason. The decisions
   and their sources: [document-retention-policy.md](../../privacy/document-retention-policy.md).
2. **The personal code on a contract** is an asked field in v1: Personnel files' sealed code is
   not reachable from the vault, by decision 5.
3. **Droplet capacity** for the worker, with and without LibreOffice (Consequences).
4. **A managed Postgres** must allow `CREATE EXTENSION unaccent, pg_trgm` if the database ever
   moves.
5. **Search quality without a stemmer**, measured on real documents after phase 4.
