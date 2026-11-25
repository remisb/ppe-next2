# Document template service

Document templates and generating documents from them: a template of blocks edited in
Administration, published as an immutable version, filled with an employee's, a company's and an
employment's values and the user's answers, and drawn as a locked PDF that is stored in the
Document Vault. Decisions in [ADR 0008](../architecture/adr/0008-document-vault.md) (6, 7);
documents, types and storage in [vault-service.md](vault-service.md).

**Status: phase 3 built** (migration 0063); DOCX templates are phase 8.

- **Packages:** `internal/vault/template` (entity, service, repository, Postgres, `fields.go`,
  `blocks.go`), `internal/placeholder` (`Parse`, `Render`: extracted from
  `internal/domain/mailtemplate/template.go`, which then uses it with its tests unchanged),
  `internal/pdffonts` (the embedded fonts, adding italic and bold italic; `formpdf.Fonts()` wraps
  it), `internal/docpdf` (draws blocks on pdf-mini's `layout`), later `internal/vault/docx`.
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
| `body` | the blocks, JSONB, `ppe.blocks.v1` |
| `asked` | the asked fields it declares (below) |
| `body_sha256` | of the canonical body, part of every generated document's hash |
| `file_id` | phase 8: the uploaded DOCX |
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

Migration `0067`: `template_versions.kind` and `file_id`. **Upload DOCX Template** in
Administration: the file is sniffed as DOCX, placeholders split across Word's runs are joined,
every `{{…}}` is checked as a field (`internal/placeholder`), `{{document.number}}` and
`{{document.hash}}` are required. Generate merges the values into the DOCX and the worker's
`vault.render_docx` converts it (`soffice --headless --convert-to pdf`, a profile per job, a
timeout); the version keeps the DOCX as its `source` file and the PDF as `main`. Preview waits for
the worker.

## Routes

| Route | Permission | Notes |
| --- | --- | --- |
| `GET /api/v1/document-templates` | `document_templates.manage` | Administration's list |
| `POST /api/v1/document-templates` | `document_templates.manage` | |
| `GET /api/v1/document-templates/{id}` | `document_templates.manage` | with versions |
| `PUT /api/v1/document-templates/{id}/draft` | `document_templates.manage` | |
| `POST /api/v1/document-templates/{id}/publish` | `document_templates.manage` | 400 with problems |
| `POST /api/v1/document-templates/{id}/retire` | `document_templates.manage` | |
| `GET /api/v1/document-templates/fields` | `document_templates.manage` | the app's fields and the types a template may be for |
| `PUT /api/v1/document-templates/{id}` | `document_templates.manage` | name and language |
| `POST /api/v1/document-templates/preview` | `document_templates.manage` | a body as edited, with the fields' samples: `{pdf}` (base64) |
| `GET /api/v1/vault/templates` | `vault.manage` or `vault.employment.manage` | published, not retired templates of the types the user may change |
| `POST /api/v1/vault/generate/preview` | the same, the type's checked | `{pdf, values_hash}` |
| `POST /api/v1/vault/generate` | the same | 409 when the values changed since the preview; 503 for a sealed type without keys |

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
