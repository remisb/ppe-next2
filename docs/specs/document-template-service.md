# Document template service

Document templates and generating documents from them: a template of blocks edited in
Administration, published as an immutable version, filled with an employee's, a company's and an
employment's values and the user's answers, and drawn as a locked PDF that is stored in the
Document Vault. Decisions in [ADR 0008](../architecture/adr/0008-document-vault.md) (6, 7);
documents, types and storage in [vault-service.md](vault-service.md).

**Status: built**: templates of blocks (phase 3, migration 0063) and DOCX templates (phase 8,
migration 0067).

- **Packages:** `internal/vault/template` (entity, service, repository, Postgres, `fields.go`,
  `blocks.go`), `internal/placeholder` (`Parse`, `Render`: extracted from
  `internal/domain/mailtemplate/template.go`, which then uses it with its tests unchanged),
  `internal/pdffonts` (the embedded fonts, adding italic and bold italic; `formpdf.Fonts()` wraps
  it), `internal/docpdf` (draws blocks on pdf-mini's `layout`), `internal/vault/docx` (phase 8:
  tells, reads, fills and converts a DOCX).
- **Routes:** `cmd/api/document-template-routes.go` (Administration's and generation's); generation itself is
  `internal/vault/document/generate.go`, through the ports `Templates`, `People` and `Users` (`cmd/api/wire_vault.go`).
- **Migration:** `0063_document_templates`: `vault.templates`, `vault.template_versions` (a trigger
  refuses changing or deleting a published one), `vault.document_number_counters` (references nothing,
  so test setup names it in its `TRUNCATE`), `documents.template_id`/`template_version`,
  `versions.data` (a generated version's values), the permission `document_templates.manage`
  (Administrator).
- **Apps:** Administration's **Document Templates** (`/admin/document-templates`,
  `routes/document-templates.tsx`, rules `lib/document-templates.ts`); the staff app's
  **Generate Document…** on the employee page.

pdf-mini v0.7.0's `layout` has what the renderer needs (rich spans, tables with header rows, page
breaks, spacers, rules); it was not extended.

## Template

| Column | Notes |
| --- | --- |
| `id`, `type` | a document type with the `generated` origin (`employment.contract`, …) |
| `name` | unique per type among live templates, 1–120 characters ("Employment contract, LT, full time") |
| `language` | `lt`, `en`, `ru`: how long dates and money are written |
| `status` | `draft` (never published), `published`, `retired` |
| `current_version` | the published version Generate uses |
| `created_*`, `updated_*`, `deleted_*` | as everywhere |

### Template version (`vault.template_versions`)

| Column | Notes |
| --- | --- |
| `template_id`, `number` | 1, 2, …; at most one `draft` per template |
| `state` | `draft` or `published` (a trigger refuses any change to a published row) |
| `kind` | `blocks` (phase 3) or `docx` (phase 8) |
| `body` | the blocks, JSONB, `ppe.blocks.v1`; for a DOCX `ppe.docx.v1`: no blocks, the file's `docx_sha256` and the `fields` its placeholders name (so `body_sha256` covers the file) |
| `asked` | the asked fields it declares (below) |
| `body_sha256` | of the canonical body, part of every generated document's hash |
| `docx_key`, `docx_name`, `docx_size` | phase 8: the uploaded DOCX in the files store, `vault-templates/<template>/<sha256>.docx` (one key per content, so a published version's never changes) |
| `published_at`, `published_by_user_id` | |

**Save draft** writes the draft (creating one from the current version when none exists).
**Publish** checks it (every placeholder is a known field, asked fields complete, required
`{{document.number}}` present), makes it the current version and freezes it. **Retire** hides
the template from Generate; documents made from it keep naming it. Events
`document_template.created`, `.draft_saved`, `.published`, `.retired` (Administration's audit
area **Document Templates**, entity type `document_template`).

## Blocks (`ppe.blocks.v1`)

A version's body is a list of blocks, decoded strictly (unknown keys refused, as `decodeJSON`):

| Block | Holds |
| --- | --- |
| `heading` | level 1–3, inline text |
| `paragraph` | inline text, alignment (left, centre, justify) |
| `list` | ordered or not, items of inline text, one level deep |
| `table` | rows of cells of inline text; first row a header or not; column widths in parts |
| `fields` | a two-column table of label and field (the parties' details) |
| `signatures` | one to three signature boxes, each with a label and an optional field under the line |
| `page_break`, `spacer` | |

**Inline text** is a list of runs: text with `bold` and `italic`, or a field `{{key}}`. No HTML,
no links, no images, no conditions or loops. A field whose value is empty prints its label in
brackets in a preview and refuses Generate when it is required.

The editor in Administration is **structured**, not a rich-text editor (no new dependency): the
body is a list of block cards, each with its kind's controls, and inline text is typed as plain
text with a light markup, `**bold**`, `*italic*` and `{{field}}`, which `lib/document-templates.ts`
converts to runs and back (tested for round trips). The **Fields** panel inserts a `{{key}}`;
**Add Asked Field** declares an `input.*` field. **Preview** draws the unsaved draft on the server
with the fields' samples.

## Fields (`internal/vault/template/fields.go`)

| Field | Value |
| --- | --- |
| `employee.name`, `.first_name`, `.last_name`, `.code`, `.birth_date`, `.nationality` | the employee (People), through the vault's `People` port |
| `company.name`, `.code`, `.vat_code`, `.address` | the company of the chosen employment (its registration code, VAT code, and address with postal code and city) |
| `employment.from`, `.until` | the chosen employment period (else the open one, else the latest) |
| `document.number`, `.date` | the new document's number and date; the hash is in the footer only |
| `user.name` | who generates it |
| `today` | the day in `API_ORG_TIMEZONE` |
| `input.<key>` | an **asked field** the template declares |

An **asked field** has a key (`[a-z][a-z0-9_]*`), a label in the template's language, a kind
(`text`, `long_text`, `date`, `number`, `money` in euro cents, `choice` with its options) and
whether it is required. The personal code is an asked field in v1 (ADR 0008, open question 2).
Dates and money are written in the template's language (*2026 m. lapkričio 24 d.*).

## Generate

On the employee page's Documents section, **Generate Document…** (shown when a published template
of a type the user may change exists): template → employment (when the person has several) →
asked fields → **Preview** (the PDF in the preview sheet) → **Generate**, enabled only while the
choices are those previewed (`lib/generate.ts`).

1. `POST /api/v1/vault/generate/preview` with `{template_id, employee_id, employment_id,
   inputs}`: resolves every field, draws the PDF with *PREVIEW* in the footer and no number, and
   answers it with `values_hash` (SHA-256 of the canonical values). Nothing is stored or
   recorded. `no-store`.
2. `POST /api/v1/vault/generate` with the same and `values_hash`: resolves again and refuses
   with 409 (`stale`) when the hash differs (a value changed since the preview, as Give refuses
   a stale form hash). Then it takes the next **document number** from
   `vault.document_number_counters` (per type and year, the type's prefix: `EC-2026-0001`; a
   number given to a generation that then fails is not given again), computes the document
   hash over the canonical JSON of {type, template id, version, body SHA-256, number, date,
   values}, draws the PDF (`internal/docpdf`, its creation date passed in, so the same input
   draws the same bytes) with the footer *Document <number> v1 · SHA-256 <hash>*, seals it for
   a sealed type, writes the object, then, in one transaction, the document (`origin`
   `generated`, titled the template's name and the number), version 1 (`generated`, the values
   in `data`, or sealed with the note and file name in `data_sealed`), the file
   (`<number>.pdf`), links to the employee and the company (locked), its text from the blocks
   (`read`, `method` `blocks`; for a sealed type only its search words without digits) and the event
   `vault.document_generated` (type, template and version, number; never a value).
3. The signed paper is added to the document as a new version (**Add Version…**, origin
   `added`; a separate **Upload Signed Copy** with origin `signed` is to come); its text is read
   by the worker (phase 4).

To come: an annex generated from its contract's page (its `parent_id`).

## DOCX templates (phase 8)

A template may be an uploaded Word document instead of blocks: its layout, fonts and styles are
Word's, its `{{field}}` placeholders filled on generation, and the filled document turned into a
locked PDF by LibreOffice in the worker (the API's image has none).

- **Upload** (`POST /api/v1/document-templates/{id}/draft/docx`, multipart: `file`, and the asked
  fields as JSON in `asked`; `template.Service.UploadDocx`). The file must be a DOCX (a zip with
  `word/document.xml`; else 415) of at most 5 MB, unpacking to at most 60 MB (413). Its
  placeholders in the body, headers and footers are read paragraph by paragraph, joined where
  Word split them across runs (`docx.Fields`); each must be a field the app fills or an asked one
  (400 naming it), and one whose `}}` is in another paragraph is refused. The file is stored
  first, then it becomes the draft (`kind` `docx`, `draft_saved` with the kind and hashes).
  Saving the draft again with the same `ppe.docx.v1` body changes only the asked fields (an asked
  field the DOCX uses cannot be dropped); a blocks body makes the draft blocks again.
- **Publish** also needs `{{document.hash}}` (an app field since phase 8, the generated
  document's hash), as a DOCX prints its own footer.
- **Generate** (`document.Service.Preview`, `Generate`): the values are filled into the DOCX
  (`docx.Merge`: each value where its placeholder starts, in its run's formatting, escaped; the
  rest of the file byte for byte), Preview with `PREVIEW` for the number and hash. The filled DOCX
  waits as a **render** (`vault.renders`): sealed with a key of its own under `API_VAULT_KEY`
  (`vault/renders/<id>.docx`), so DOCX templates need it (503 without), and a job
  `vault.render_docx` queued. Both routes answer **202** `{render_id, state: "pending"}` (preview
  with its `values_hash`); the API's 10-second request limit is no place to wait for a conversion.
- **The worker** (`RenderDocx`, `renderHandler`; served only with `soffice`, the files store and
  the vault's key) converts it (`docx.Converter`: `soffice --headless --convert-to pdf`, a folder
  and a LibreOffice profile of its own per job, HOME there, its process group killed on the job's
  timeout) and keeps the PDF sealed beside it; a failure on the last attempt marks the render
  failed (`error`: `conversion_failed`, `timeout`, `damaged`).
- **Polling** (`GET /api/v1/vault/renders/{id}`, the reader's own renders only, else 404):
  202 while pending; a preview's PDF and `values_hash` (200); a document's render makes the
  document once its PDF is there and answers it (201, the same document when asked again):
  version 1 with the PDF as its `main` file and the filled DOCX as its `source` file
  (`vault/<document>/<file>.docx`), both sealed for a sealed type, its read text from the DOCX's
  words, `vault.document_generated` as for blocks. A failed render answers 422. Its number was
  taken at Generate, so an abandoned render leaves a gap in the numbers.
- The upkeep removes renders an hour old, with their files (`PurgeRenders`).
- **Administration**: on a template, ⋯ → **Upload DOCX Template…** (or **Replace DOCX…**): a DOCX
  draft shows its file, the fields it uses (an unknown one marked, with what to do), **Replace
  DOCX…**, **Download DOCX** (`GET …/versions/{n}/docx`) and **Write in the Editor Instead**; the
  asked fields stay editable; there is no editor preview (Generate's preview draws it).
- **Staff app**: Generate Document… polls a render (`awaitRender`, every 1.5 s for up to two
  minutes, then "still being made"), so the sheet reads the same for both kinds.

## Routes

| Route | Permission | Notes |
| --- | --- | --- |
| `GET /api/v1/document-templates` | `document_templates.manage` | Administration's list |
| `POST /api/v1/document-templates` | `document_templates.manage` | |
| `GET /api/v1/document-templates/{id}` | `document_templates.manage` | with versions |
| `PUT /api/v1/document-templates/{id}/draft` | `document_templates.manage` | |
| `POST /api/v1/document-templates/{id}/publish` | `document_templates.manage` | 400 with problems |
| `POST /api/v1/document-templates/{id}/draft/docx` | `document_templates.manage` | multipart `file`, `asked`; 400, 413, 415, 503 |
| `GET /api/v1/document-templates/{id}/versions/{n}/docx` | `document_templates.manage` | the DOCX, an attachment |
| `POST /api/v1/document-templates/{id}/retire` | `document_templates.manage` | |
| `GET /api/v1/document-templates/fields` | `document_templates.manage` | the app's fields and the types a template may be for |
| `PUT /api/v1/document-templates/{id}` | `document_templates.manage` | name and language |
| `POST /api/v1/document-templates/preview` | `document_templates.manage` | a body as edited, with the fields' samples: `{pdf}` (base64) |
| `GET /api/v1/vault/templates` | `vault.manage` or `vault.employment.manage` | published, not retired templates of the types the user may change |
| `POST /api/v1/vault/generate/preview` | the same, the type's checked | `{pdf, values_hash}`; for a DOCX 202 `{render_id, state, values_hash}` |
| `POST /api/v1/vault/generate` | the same | 409 when the values changed since the preview; 503 for a sealed type without keys, or a DOCX without `API_VAULT_KEY`; for a DOCX 202 `{render_id, state}` |
| `GET /api/v1/vault/renders/{id}` | the same | the reader's render: 202 pending, 200 `{pdf, values_hash}`, 201 `{document}`, 422 failed |

## Tests

- `internal/placeholder`: Mail Templates' tests unchanged and passing through it.
- Blocks: strict decoding refuses unknown keys and HTML; the editor's round trips.
- `internal/docpdf`: the same input draws the same bytes; every block kind; long tables break
  across pages.
- Service: publish refuses unknown fields; a published version cannot change; stale
  `values_hash` is 409; numbers never repeat under concurrent generation (Postgres); the event
  holds no value.
- Built: `internal/placeholder` and Mail Templates' tests; `internal/docpdf` `TestRenderIsDeterministic`;
  `internal/vault/template` (`TestTemplateLifecycle`, `TestWritten`, `TestInputs`, `TestDecodeBodyIsStrict`);
  `internal/vault/document` `TestGenerateAfterPreview`, `TestGenerateRefuses`; `TestPostgresDocumentTemplatesHTTP`;
  the apps' `lib/document-templates.test.ts` and `lib/generate.test.ts`.
- To come: an e2e step (publish a template in Administration, generate a contract, upload its signed copy).
