# Project map: what is built and where

Moved out of CLAUDE.md on 2026-11-27, so it is no longer loaded into every Claude session.
Read the part about the area you are changing. The rules are in the specs in `docs/specs/`
and the ADRs in `docs/architecture/`; this page says where things live and how they connect.
Update a paragraph when its area changes shape (a new package, route family, app or migration
others must know about), not for every feature: the history is in git and the issues.

Early build-out, following the slice plan derived from the Developer Logic Manual.
Implemented: the Go API skeleton, the **user service** (JWT login, roles
`admin`/`manager`/`employee`), and Slice 1 — migrations 0002–0007 (audit, employees,
catalogue, item sets, orders + snapshot lines, confirmations), `internal/audit`,
`internal/domain/size` (vocabulary + resolution rules), entity types for all domains, and
Slice 2 — employee and catalogue services with routes and audit events — and Slice 3:
item sets, Create Order resolution (`order/resolve.go`, read-only), and the
`web/apps/workwear` app (Create Order, Employees with a per-employee page of items given,
Item Catalogue with each item opened beside the list, Item Sets, and Users for admins) — and
Slice 4: Mark as Ordered (`POST /api/v1/orders`, snapshot copy in one transaction) and
Copy for WhatsApp — and Slice 5: History, the Orders screen at `/orders` (`GET /api/v1/orders`, query-parameter filters
in the organisation timezone `API_ORG_TIMEZONE`, server-computed `usage_months`).
— and Slice 6: confirmation links (hashed tokens, sent in request bodies), paper
confirmation, in-person confirmation on a staff device (hand-over mode, method `IN_PERSON`,
an addition to the manual), idempotent ORDERED → GIVEN, and the locked bilingual receipt with document
hash and A4 print (`order/confirmation.go`, `order/receipt.go`, `web/.../routes/confirm.tsx`).
The public `/confirm/<token>` page renders before the sign-in gate. An administrator starts on the
Dashboard, a manager on the Manager Dashboard and the employee role on the Employee
Dashboard (`internal/domain/dashboard`, read-only figures, `GET /api/v1/dashboard` admins
only, `/dashboard/manager` managers only, `/dashboard/employee` the employee role only, for
the signed-in user's own orders; spec `docs/specs/dashboard-service.md`). Slice 7 added the
Playwright e2e suite (`web/e2e`), CI (`.github/workflows/ci.yml`) and `docs/testing.md`,
which maps every manual §7 rule and status transition to its tests. Administrators set the
supplier's WhatsApp group on Settings (`internal/domain/settings`, migration 0018, one row
at most; spec `docs/specs/settings-service.md`), which Copy for WhatsApp opens for order messages;
the same row holds the SIM providers Add SIM offers, the default one and the default Non-return Value it fills in (migrations 0031, 0033, 0034), listed on Settings; each provider is a row of `sim_providers` (migration 0039, going with the settings row) with the e-mail its SIM emails go to and the default plan Add SIM and Give SIM fill in (one plan for all until 0039).
**Suppliers** (`internal/domain/supplier`, migration 0054, spec `docs/specs/supplier-service.md`): the companies
catalogue items are bought from (internal code unique among live suppliers, name, company and VAT codes, address,
contact, IBAN, notes), managed on Administration's **Suppliers** (`suppliers.manage`, Administrator), read by everyone;
an item names one optionally (`catalogue_items.supplier_id`, chosen on Edit Item, checked through `catalogue.Suppliers`),
and a deleted supplier reads as none (the catalogue's reads join live suppliers only).
**Companies and employment** (migrations 0057, 0058; specs `docs/specs/company-service.md` and "Employment" in
`employee-service.md`): the organisation's companies (`internal/domain/company`, Administration's **Companies**,
`companies.manage`, Administrator; name required, optional internal code, legal details), one the **default company**
(the first added; **Make Default**), which Add New Employee chooses first and `{{company.name}}` writes (Settings'
Company name became it in 0057). An employee's **employments** (`employments`, a child of the employee under its row
lock: one open, none overlapping) make a record an employee, a **candidate** (none; may be employed later, may still
receive orders and assets) or a **former employee** (`Employee.status`, derived; the list's tabs and `?status=`);
Employ…, Move to Another Company…, End Employment… on the employee's page (`components/employment-section.tsx`),
`employee_profiles.manage`. The names stay `employee*` (the sealed audit trail's events included): People is ADR 0001's
later step. Merge moves the periods and refuses two records employed now. `TRUNCATE users CASCADE` empties `companies`
too, so a test that adds employees adds a company first (e2e's Companies step does).
**Document Vault**, phase 1 (ADR 0008, migration 0061, spec `docs/specs/vault-service.md`): `internal/vault` (types fixed in code,
`vault.Types()`) and `internal/vault/document` (upload, versions, links, search), schema `vault` with `unaccent`, `pg_trgm` and the
search configuration `vault.ppe`; routes `cmd/api/vault-routes.go`, adapters `cmd/api/wire_vault.go` (the vault imports no domain:
`internal/vault/imports_test.go`); `vault.read`/`vault.manage` (Administrator, Manager). The staff app's **Document Vault**
(`/vault`, a document beside the list at `/vault/<id>`, `routes/vault.tsx`, `lib/vault.ts`) and a **Documents** section on the
employee page and an asset. Versions and files are append-only; Merge Employees moves the links; the upkeep renames them.
Phase 2 (migration 0062): **sealed** Employment documents (`employment.contract`, `.annex`, `.nda`, `.other`), each sealed with a data key
of its own under the optional `API_VAULT_KEY` (`vault.document_keys`; without it they answer 503), for the add-on role **Employment
Documents** alone (`vault.employment.read`/`.manage`, Administrator included only when holding it); a sealed file opens only by
`POST …/versions/{n}/file` behind `sensitive`, recorded first; the upkeep's `ShredDue` keeps each for its type's months after the
employee's employment ended, then shreds it through the owner's `vault.shred_document` (a tombstone stays) unless under a **Legal Hold**.
Phase 3 (migration 0063, spec `docs/specs/document-template-service.md`): **document templates** (`internal/vault/template`: a body of blocks,
`ppe.blocks.v1`, with `{{field}}` placeholders, `internal/placeholder` shared with Mail Templates, and asked fields), edited in Administration's
**Document Templates** (`document_templates.manage`, Administrator; a structured editor, no rich-text dependency) and published as versions
that never change; the staff app's **Generate Document…** on the employee page previews, then generates a numbered (`EC-2026-0001`),
hashed, locked PDF (`internal/docpdf` on pdf-mini, fonts `internal/pdffonts`), sealed for employment types. `vault.document_number_counters`
references nothing: Postgres tests and e2e name it in their `TRUNCATE`.
Phase 4 (migration 0064, spec `docs/specs/outbox-service.md`): the **outbox** (`internal/outbox`: `outbox.jobs` written in the change's
transaction, claimed `FOR UPDATE SKIP LOCKED` under a lease, retried with back-off; `outbox.workers` heartbeats) and the **worker**,
`api -worker` in the **docworker** image (the root `Dockerfile`'s `docworker` target: Debian with Poppler and Tesseract eng/lit/rus/osd;
compose service `docworker`, read-only, `API_WORKER_*`): `vault.extract_text` reads every uploaded version's text (`internal/vault/extract`:
`pdftotext`, else `pdftoppm` and OCR) for search, a sealed one's as digit-free words only; Read Again on a version, `api -vault-reindex`,
System's **Worker** card (`GET /api/v1/system/worker`), the Overview's `worker_silent`/`jobs_failed`, and documents in ⌘K. The tools are
not needed locally: their test is `-tags tools` (CI, or a Debian container); e2e runs no worker. Postgres tests empty `outbox.jobs` too.
Phase 5 (migration 0065): Company Assets' **signed copies are kept in the vault**, through the `SignedForms` port
(`asset/signed_copy.go`: `Add`, `Of`, `Open`, `Holding`; adapter `assetSignedForms` in `cmd/api/wire_vault.go`): one `asset.signed_form`
document per assignment (source kind `asset_signed_form`, a type with a `Source` and no `manage`: added by its source alone), each copy
a version whose id is the copy's, the asset's own `asset.signed_copy_uploaded` event recorded in the vault's transaction; routes, JSON
and screens unchanged. The migration's `vault.move_signed_copies()` moved every old row (same ids, keys, hashes; no object copied);
`asset_signed_copies` is frozen (`ppe_app` only reads it) until a later release drops it; `api -vault-backfill [-commit]`
(`make prod-vault-backfill`) checks the move and the files. The asset repository no longer knows whether a copy exists: the
service fills `signed_copy_uploaded` from `Holding` and passes it to the register's `signed_copy=missing` filter.
Phase 6 (no migration): **assignment forms and Items Given Records are archived** as PDFs (types `asset.assignment_form`,
`order.record`, each with a `Source`, no `manage`). Give and a confirmation that gives an order call their domain's `Archiver`
after commit (`asset/archive.go`, `order/archive.go`), which only queues `vault.archive` (adapter `vaultArchiver`); the worker's
handler draws the record through the `Records` port (`vaultRecords`: `formpdf`, and `internal/recordpdf` for the Items Given
Record, also `GET /api/v1/orders/{id}/record.pdf`, Download PDF on the record page) and keeps it once (unique source), with
`vault.document_archived` (no actor). The upkeep sweeps the last 7 days (`sweepArchives`: `FormsSince`, `GivenSince`);
`api -vault-backfill -commit` queues all records before it. **Verify** (`GET /api/v1/vault/documents/{id}/verify`, the document
pane's Verify) hashes the domain's snapshot again and checks the file. The domains' snapshots and hashes stay the truth.
**Retention** (migration 0066, `internal/vault/document/retention.go`): every type's period is Lithuania's minimum (the index for
internal records, "VAD", from 2024-10-01): contracts, annexes, NDAs 50 years after employment; other employment papers, certificates,
training 3; invoices, asset papers 10 after their date; forms and signed copies 10 after the asset's return; Items Given Records 1
after the longest service period (rule `AfterSourceEnds`, `Records.Ended`); each from 1 January after. Every type with a period is
shredded when due by `vault.shred_document`, sealed or not; Legal Hold for any such type (`vault.manage` for archived ones).
The decisions and sources: `docs/privacy/document-retention-policy.md`.
Phase 7 (no migration): **ID documents are listed, metadata only**: the `IdentityDocuments` port (`vault/document/identity.go`,
adapter `vaultIdentity` over Personnel files' `Documents`) adds `identity` to a search about an employee (filtered by them, or words
naming a linked employee; at most 10; first page): kind, issuing state, expiry, and with `personnel.documents.read` superseded ones and
issue dates. The Document Vault shows them above its list; the holder opens `/employees/<id>/page#identity`. By-subject lists none.
Phase 8 (migration 0067): **DOCX templates**: Administration's ⋯ → Upload DOCX Template… makes a Word document the draft
(`internal/vault/docx`: placeholders joined across Word's runs, checked, filled; `template.Service.UploadDocx`, stored as
`vault-templates/<template>/<sha>.docx`; Publish also needs `{{document.hash}}`). Generating from one is asynchronous: the API fills the
DOCX, keeps it as a sealed **render** (`vault.renders`, needs `API_VAULT_KEY`) and answers 202 `{render_id}`; the worker's
`vault.render_docx` converts it with LibreOffice (`docx.Converter`, `soffice` in the docworker image); the app polls
`GET /api/v1/vault/renders/{id}` (`awaitRender`) for the preview's PDF or the document, made once with the PDF as main file and the filled
DOCX as source. The upkeep purges renders after an hour.
**Mail templates** (`internal/domain/mailtemplate`, migration 0040, spec
`docs/specs/mail-template-service.md`): one template per use case fixed in code (`sim.activation`,
`sim.blocking`), To/Cc/Subject/Message with `{{field}}` placeholders, edited on Administration's
**Mail Templates** (`mail_templates.manage`, Administrator); `Render` produces a recipient, Cc, subject and
body and nothing is ever sent from the app (the sheet's **Send Email** is a `mailto:` link to the user's own mail app). Company Assets prepares Prepare Activation Email and Prepare Blocking
Email through it (`GET /api/v1/assets/{id}/emails/{kind}`, `asset.Mailer` adapted in `cmd/api/checkers.go`
with Settings' provider e-mail and the default company's name).
Database backups: the `backup` compose service is the agent from the separate library
`github.com/remisb/dbbackup` (local checkout `../../remis-libs/dbbackup`), which dumps
Postgres on a schedule and records each run in `dbbackup_runs`/`dbbackup_agents`
(migration 0019, dbbackup's schema copied verbatim); administrators read them on the
Backups tab of Administration's System and a Dashboard card (`internal/domain/backup`, `GET /api/v1/backups`, read-only;
spec `docs/specs/backup-service.md`, operations and Postgres upgrades `docs/backups.md`).
Sign-ins are sessions (`internal/domain/session`, migration 0020, spec
`docs/specs/session-service.md`): an HttpOnly refresh cookie rotated on every refresh, with
reuse detection, "Keep me signed in" (30 days, 14 idle; else 12h and the browser's life),
signed-in devices on Account, sessions ended on password change or reset, deactivation and
deletion, and a recent sign-in (password within `API_RECENT_SIGN_IN`) for managing users.
Access is by **permission** (ADR 0002): a fixed catalogue in `internal/domain/role`
(`permission.go`), bundled into **roles** that are rows (migration 0022: `roles`,
`role_permissions`, `user_roles`; spec `docs/specs/role-service.md`). The built-in
Administrator, Manager and Employee reproduce the old three roles; administrators add and
change others on Roles & permissions. The token's `perms` claim carries what the user's
roles allow. A fourth built-in, **Equipment Assignments** (migration 0032), alone grants
`equipment.read`: Equipment & Furniture and who holds each item are hidden from everyone
else, administrators included (`asset.Sight`; the API answers 404 for such an item). Migration 0038 split two
permissions off wider access, granting them to every role that had it: **See Item Sets**
(`item_sets.read`; the active sets stay open for Create Order) and **Change Item prices**
(`item_prices.manage`, needs `catalogue.manage`; `catalogue.Rights` refuses a price change
without it). **Administration** is a second web app at `/admin/` (`web/apps/admin`:
Overview, Users, Roles & permissions, Audit log, Security, System, Usage, Settings, Mail Templates, Suppliers, Companies, Manage apps) on the staff app's origin, sharing its sign-in and
the packages `@ppe/ui`, `@ppe/app-shell`, `@ppe/i18n`, `@ppe/backups` and `@ppe/audit`; the
administrator's Dashboard stays in the staff app. The **Audit log** (`audit.read`, migration
0023, spec `docs/specs/audit-service.md`) reads every recorded change with the request,
sign-in and app it was made in; employees, catalogue items and orders show their own
**Changes** in the staff app (the glossary's "History" is Orders, so not that word).
**Security** (`security.read`, migration 0024, spec `docs/specs/security-service.md`, ADR
0003) reads the security log `auth_events` (`internal/security`): every sign-in, failed
attempt and ended session with its address, written by the session repository in the
session's own transaction, kept `API_AUTH_EVENTS_RETENTION` (180 days) and purged hourly by
the API (`cmd/api/jobs.go`); the per-email sign-in limit counts it. It also lists every
user's signed-in devices (signing one out takes `users.manage`) and the access review, whose
Mark as reviewed is an audit event. **System** (`system.read`, migration 0025, spec
`docs/specs/system-service.md`) shows the API (`internal/monitor`: a 24-hour request window
in memory, Prometheus `/metrics` on `API_METRICS_ADDR`), the database, the error list
(`internal/system`, `error_events`: 5xx answers, panics, the apps' browser errors) and Backups as a tab;
the **Overview**, Administration's first screen, lists what needs attention
(`internal/overview`) for whatever areas the reader may open. Every request's ID is on its log
lines (`request_id`) and a 500's `reference`, which the apps show. The **Audit log** is sealed
daily (`audit_seals`, migration 0026: each UTC day's events hashed and chained), each seal
anchored by a trusted timestamp (RFC 3161, `internal/tsa`, `audit_seal_stamps`, migration
0028, `API_AUDIT_TSA_URL`: DigiCert in production, off elsewhere), verified
hourly and on demand, purged after `API_AUDIT_RETENTION` (10 years) and exported by
`audit.export` (spec `docs/specs/audit-service.md`). **Usage** (`usage.read`, migration 0027,
spec `docs/specs/usage-service.md`, `internal/usage`) shows active people per day (from
`user_activity`, written once a day per user and app by the request middleware), sign-ins,
changes per week, devices, languages, the confirmation-link funnel
(`order_confirmations.first_opened_at`, `order.confirmation_link_opened`) and a daily
data-quality sample; its charts are `@ppe/ui/components/charts`, which the Dashboards use too.
**Company Assets** (SIM cards, equipment and furniture, ADR 0004; terms in glossary §12):
the API is built (`internal/domain/asset`, migration 0029, `cmd/api/asset-routes.go`, spec
`docs/specs/asset-service.md`): assets, assignments with one open per asset, the
assignment form as a hashed snapshot; SIM cards seen with `sim_cards.read` and changed with
`sim_cards.manage`, Equipment & Furniture changed with `assets.manage` (migration 0049 split SIM cards'
off, `asset.Rights`; a route serving both kinds is `rt.restrictedAny`, its kind checked by the handler);
Employees' names are everyone's; their profile (code, notes, language, photos, identity details) and
size defaults are `employee_profiles.read`/`.manage` and `employee_sizes.read`/`.manage` (migration 0050,
`employee.Sight` blanks the API's answers and the employee's Changes, `employee.Rights`: Edit keeps the
sizes without manage; Create Order still resolves from them). Delete employee refuses an
employee who holds assets. **Export** (WARE-43, `docs/ux/list-export.html`): Employees' rows, ticked or all shown, with chosen columns as
Excel or CSV, built in the browser by `@ppe/ui`'s `table-export.ts` (no dependency: its own stored zip), `ExportSheet` and
`SelectionBar`/`useSelection`; columns offered by permission (`lib/employee-export.ts`). WARE-44 gave every list the same
(each list's columns in a `lib/*-export.ts`, Administration's in `apps/admin/src/lib/list-export.ts`): a list loaded page by page
(Orders, SIM Cards, Equipment) exports "All matching the filters" through `ExportSheet`'s `matching` (every page fetched at export);
Exports are not on the Audit log. Export (every list's: the header button, ⋯ on a phone, select mode, `ExportSheet`) shows only with
**Export data** (`data.export`, migration 0059: every role but the three add-on ones; no route needs it, so screens check
`session.can('data.export')`; the Audit log's export stays `audit.export`). **Select mode** (WARE-45, `docs/ux/export-select-mode.html`): no list shows
checkboxes while browsing; Export (`ExportMode`) and SIM Cards' Change Status… start a mode (`useSelection`'s `mode`, `SelectModeBar`:
above the list from md, pinned above the tab bar on a phone) in which a row click ticks it (`selectRowProps`); Cancel, Esc or the
finished action end it. **Share** (WARE-51, migration 0060, spec `docs/specs/share-service.md`, `internal/domain/share`,
`cmd/api/share-routes.go`): Employees' Export sheet (`ExportSheet`'s `share`, `ShareOptions`) also offers, to everyone and up to
10 rows, **Copy as Text** (`exportText`, nothing stored) and **Share Link**: the rows as the sharer sees them (`employee.Sight`,
the chosen columns' fields alone, `employeeShareFields`) kept 1, 7 or 30 days behind a hashed token, opened by anyone at
`/shared/<token>` (`routes/shared.tsx`, before the sign-in gate; `POST /api/v1/shares/view`, public, rate limited, 410 once
gone); **Shared Links** (`/shared-links`, Employees' ⋯) lists the user's own open links to Revoke; revoking, or the upkeep once
expired, erases the rows (`shares.rows = '[]'`); events `share.created`, `share.revoked`. Without Export data Employees' button
reads Share and the sheet offers no files. **Duplicates and merging** (migration 0052, spec "Duplicates and merging" in
`employee-service.md`): Add New Employee warns of alike names (`employee.CompareNames`, `POST …/employees/similar`)
with Use This Employee; Employees offers possible duplicates (Not the Same Person, `employee_distinct_pairs`) and
**Merge Employees** (`employees.merge`, Administrator and Manager): one transaction moves the removed record's orders,
asset assignments (`asset_assignments_guard` allows it only under `SET LOCAL ppe.employee_merge = on`) and photos,
and removes it with `merged_into_id` (its reads answer 404 with `existing_id`); a record with identity documents is kept. Company Assets is two screens, listed under it in the rail, the sidebar and a phone's More panel: SIM Cards
(`/assets/sim-cards`) and Equipment (`/assets/equipment`). The SIM card register is on screen (`routes/assets.tsx`,
`lib/assets.ts`: tabs with counts that filter, Add SIM, Change Status; a row opens the card
beside the register at `/assets/sim-cards/<id>`, as Orders opens an order, and Equipment's at `/assets/equipment/<id>`) and the asset page (`/assets/<id>`, its detail
`components/asset-detail.tsx` shared with that pane:
Give SIM against a printed form, Return, Mark as Not Returned, Prepare Blocking
Email; `components/asset-sheets.tsx`), Given SIM on the employee page, card numbers in ⌘K and a
Company Assets card on the dashboards, and Equipment & Furniture on the same engine (the Equipment screen,
`components/equipment-form.tsx`; furniture is given without a form, the API's `needs_form`), and
the go-live import of the SIM card list (`api -import-sims`, `make prod-import-sims FILE=… COMMIT=yes`:
a CSV checked in full, then written all or none, held cards given without a form; spec "Import SIM cards"), and
signed copies (slice 5, migration 0030: Upload Signed Form on an assignment, a PDF, JPEG or PNG up to
10 MB kept in object storage by `internal/files`, `API_FILES_TARGET`: a private Spaces bucket in
production, the folder `.files` in development; `components/signed-copies.tsx`). Employees have **photos**
(`internal/domain/employeephoto`, migration 0037, routes under `/api/v1/employee-photos/{employee}`,
spec "Photos" in `employee-service.md`): any number each in the files store, one the default
(`Employee.default_photo_id`, the avatar in the Employees list), each with optional uses from a
fixed list (`PHOTO_USES`). **Scan SIMs** (ADR 0005, spec "Scan SIM cards" and "PIN and PUK"
in `asset-service.md`) is a **trial app**, published at `/apps/sim-scan/` (`web/apps/sim-scan`, the third on the
origin, reporting as `sim-scan`; its rules, readers, words and review list in
`web/packages/sim-scan`, on `@ppe/scan-kit`'s camera, workers, pictures and reader-files plugin
(shared with docs-import), to merge into the staff app beside SIM Cards once it passes): newly
received SIM cards read from their carriers in the browser (zxing-wasm for the SIM No.'s
barcode, tesseract.js for the PIN and PUK; their files its build's own, under `readers/`), with
the camera (on a phone full screen, as a camera app: `phone-camera.tsx`) or from photos, checked in a review list (`POST /api/v1/assets/sim-cards/batch/check`)
and added all or none (`…/batch`, `asset.Service.AddSIMs`, the import's core), and Show PIN and
PUK (`POST /api/v1/assets/{id}/sim-codes/show`, `sim_cards.read` since migration 0055 retired
`sim_codes.read`, no recent sign-in, `asset.sim_codes_shown`; WARE-37: the staff app's SIM card, pane
and page, has the key too, `components/sim-codes.tsx`, greyed out when the asset's `has_sim_codes` is false). PIN and PUK are sealed by the API (AES-256-GCM, `internal/sealbox`,
`API_SIM_CODES_KEY`, required, never in the database or its backups) in `asset_sim_codes`
(migration 0041, which also makes `…5` and `…5F` the same SIM No.: `asset.simKey`). Slice 8 (go-live
tools) waits for the open decisions.
**Personnel files** (ADR 0007; specs `personnel-service.md`, `ai-usage-service.md`) is being built for the
docs-import app: migration 0048 (schema `personnel`, the role Personnel Documents and its permissions),
**Import Documents** (`web/apps/docs-import`, published, device profile, POC; for `personnel.documents.manage`) reads
a passport's or ID card's MRZ from photos or the live camera in the browser (`@ppe/mrz/reader`: an image worker and
tesseract.js with the OCR-B model `mrz` committed in `web/packages/mrz/readers`, BSD-3), each photo read twice, a live
reading taken when two frames agree, and saves it through the routes
below; its rules are `@ppe/id-docs` (`flow.ts` and the page, portrait and corner rules, moved from its `src/lib` for docs-scan). The staff app's employee page has an **Identity** section
(`components/identity-section.tsx`): the "valid until" line for everyone, the documents, Show Document, Mark Employment
Ended and Legal Hold for the personnel permissions. `internal/personnel/mrz` (the Go twin of `@ppe/mrz`) and `internal/personnel/document` (per-person data keys
under `API_PERSONNEL_KEY`, blind indexes, Check and Save with sealed Document Copies, Show Document (a recent
sign-in, recorded first), Remove, Mark Employment Ended, Legal Hold, and the upkeep's shredding after
`API_PERSONNEL_RETENTION_MONTHS`; routes `cmd/api/personnel-routes.go`, optional: without the keys Check, Save and Show Document answer 503).
**AI usage** (ADR 0007 D4, D8; spec `ai-usage-service.md`; migration 0051): `internal/aiusage` records every AI call
(`ai_usage`, append-only, its tokens and cost in micro-dollars by Settings' prices, a monthly budget) and keeps Settings → AI
(`ai_settings`: the switch, model, quality, prices, budget, and the company's OpenAI key sealed with the optional
`API_SECRETS_KEY`, never returned); routes `cmd/api/ai-routes.go`; Administration's Settings has the card and Usage the
**AI Usage** section (`ai_usage.read`). The **AI colour photo** (`internal/personnel/colour`: OpenAI's image edit at
`API_OPENAI_BASE_URL`, then the luminance lock) is Import Documents' Make Colour Photo (AI) on the Portrait step, for
`personnel.portraits.colorize` (no built-in role), with the person's consent; the photo is saved `ai_generated`, labelled
AI-coloured in the staff app and never the ID badge's. e2e runs a fake OpenAI on 18095.
**Scan Document** (plan FR-22), Import Documents' second tab beside **Import to Personnel** (`/scan`,
`routes/scan`, rules `@ppe/id-docs`' `scan.ts`, `page-box.ts`, `corners.ts`, the pipeline `make-page.ts`): up to 10 photos
of one person's document, each turned the way up its MRZ reads (`readPhoto(…, { turns: true })`), its 4 corners found
and flattened by a perspective transform (`@ppe/scan-kit/perspective`: our own edges, Hough lines guided by the MRZ
band, a homography and warp, in a worker), with Turn Left/Right and Adjust Corners; **Download Archive** keeps the
pages as a zip and downloads it, **Save to Personnel** hands them to Import. **Kept scans** (ADR 0007 amendment; spec
"Kept scans" in `personnel-service.md`; migration 0053, `internal/personnel/scan`, `cmd/api/personnel-scan-routes.go`):
the zip is kept `API_PERSONNEL_SCAN_DAYS` (3) days for its uploader alone, sealed under a per-scan data key in
`personnel.scans` and `personnel-scans/{id}`, and erased by the upkeep (`PurgeExpired`).
**Scan Documents** (`docs-scan`, built as a POC published app, device profile, `web/apps/docs-scan`: Scans, Camera, Details,
Find Employee, Update, Merge, Add New, Saved, Adjust Corners as addresses (`lib/router.tsx`, one router in context), its rules
`src/lib/flow.ts`, scans in progress in this tab's memory (`lib/sessions.tsx`); the printed names offered and the date of issue
taken after the MRZ (`@ppe/id-docs` `printed.ts`, `printed-reader.ts`: tesseract.js with `lit`, served from its `readers/`); [plan](docs/apps/docs-scan-plan.md), every decision made 2026-11-21; ADR 0007's
amendment of that day) reads first, then finds the person (`POST …/personnel/documents/match`, built: `document/match.go`, its `People` port
adapted in `cmd/api/checkers.go`), updates, merges or adds them; kept scans gain a state (`unread`/`read`/`saved`), `replaces`,
a page route and a link to the saved document (migration 0056, built; `ppe_app` may update those three columns alone); its mockup is `docs/ux/mockups/docs-scan.html`. It replaces Import
Documents after its trial, sharing `@ppe/id-docs`, and uses ui-sdk only through `@ppe/ui`.
**App Launcher** (ADR 0006, accepted with every recommended decision; phases 1 to 3 built; spec
`docs/specs/app-launcher.md`, guide `docs/ux/app-launcher.html`): a fourth app at `/apps/`
(`web/apps/launcher`) showing every app and shortcut a user sees as big tiles in groups, with pins
(the user's, by the API) and recent apps (per device). Its list is the API's registry
(`internal/domain/launcher`, migration 0042: `launcher_apps`, `launcher_pins`, `launcher_feedback`;
`GET /api/v1/launcher` filtered per user by permission), whose default tiles the API inserts at
start-up (`launcher.EnsureDefaults`, also after a test empties the database); administrators manage it
on Administration's **Manage apps** (`apps.manage`: register, edit, move, retire, feedback, Changes;
events `app.*`). Apps in testing (POC, In development) are for the built-in **Testers** role
(`apps.preview`), behind **Show apps in testing**. `@ppe/launcher` loads the list once per user and page
(`useLauncher`) for every app's **Apps** entry (no extra row), the staff app's ⌘K and the landing:
someone with several apps (`hasSeveralApps`) who signs in at the staff app's `/` lands on `/apps/`
(`ApiProvider`'s async `onSignedIn`). Each app sends its slug as `X-PPE-App` (`workwear`, `admin`,
`launcher`, `sim-scan`, `docs-import`, `docs-scan`); the audit trail, security log, error list and Usage record any registered slug
(the four source CHECKs widened in 0042). PPE Crew (`../PPE-staff`) is a linked tile opening its own site.
Phase 3, **published apps** (migration 0043: `launcher_versions`, `launcher_channels`,
`launcher_channel_choices`; `error_events.app_version`): an app on this site may be published as
immutable **versions** (`YYYY.MM.DD-<commit>`, a `dist/` with `ppe-app.json` declaring its slug and
**profile**, `standard` or `device`; older builds' capabilities still read) and **channels**
(Stable for whoever sees the tile, Beta and Preview for testers; named variants were removed,
migration 0047; events `app.version_published`,
`app.channel_moved`; older trails also hold `app.channel_changed`). Scan SIMs is the first, at `/apps/sim-scan/`. Caddy serves a version's files from the `published` volume at
`/apps/files/<profile>/<slug>/<version>/`; the API (`cmd/api/published-app-routes.go`, public
`GET /apps/{slug}/{rest...}`) answers only its `index.html`, links rewritten, with `ppe-mount`,
`ppe-files`, `ppe-version`, `ppe-channel` meta tags (read by `@ppe/routing`'s `basePath`/`filesBase`;
kept in memory per version, with an `ETag`)
and the profile's CSP (`TestPublishedPoliciesMatchCaddy`). `api -publish-app` reads a build's tar on
stdin into `API_APPS_DIR`; a published app is any `web/apps/<slug>` with `public/ppe-app.json`
(slug, profile, devPort), found from it by the Makefile, the web image, the dev proxy and e2e
(`@ppe/launcher`'s `published-apps.ts`), and `make new-app` starts one from `web/templates/published-app`
with its tile in `defaults.go` (POC; CI's `pnpm check:new-app` builds the template); `make prod-up` publishes `PUBLISHED_APPS` from the web image's
`/srv/build/<app>` to Preview (first time also Stable), `make prod-publish APP= REF= [CHANNEL=]`
builds a git ref (`deploy/build-app.sh`). Manage apps has **Versions and channels** (Make Stable/Beta/
Preview, **Stable follows deploys**: migration 0044, a deploy's new version then moves Stable too, a re-run
never; the Overview's `stable_behind` says when Preview has been ahead for 3 days);
the launcher's **Versions** keeps each user's choice (by the API), honoured at the app's own address,
and a published app off Stable shows `@ppe/launcher`'s `ChannelStripe`. A channel's audience decides who
sees it, not who may open it: the page and files are public, the data the API's (the stripe fails
closed to Stable). The slug rule is in `@ppe/api-client`'s `app-slugs.ts` too, and profiles map to
policies in `cmd/api` (tests hold both, and the reserved slugs, to Go and the Caddyfile). Small apps use
`@ppe/launcher`'s `SignedIn` and `AppFrame` (its bar scrolls away; the screen's header alone sticks).
Defaults are the code's until an administrator changes one (`EnsureDefaults` syncs untouched
tiles, audited). Manage apps' **Trials** (migration 0045: `user_version_activity`,
`launcher_feedback.version`) shows each version's people, errors and feedback.
`make prod-up` runs `api -prune-apps` (keeps what a channel opens and the newest five per app,
removes folders no version names, fails naming the `prod-publish` command when a channel's files
are missing) and publishes nothing from a checkout with local changes or from a web image built from
another commit (`/srv/build/.commit`); a
publish writes a recorded version's files again when they are missing (a restore, a lost volume).

