# Document template service

Document templates and generating documents from them: a template of blocks edited in
Administration, published as an immutable version, filled with an employee's, a company's and an
employment's values and the user's answers, and drawn as a locked PDF that is stored in the
Document Vault. Decisions in [ADR 0008](../architecture/adr/0008-document-vault.md) (6, 7);
documents, types and storage in [vault-service.md](vault-service.md).

**Status: decided, not built** (phase 3; DOCX templates phase 8).

- **Packages:** `internal/vault/template` (entity, service, repository, Postgres, `fields.go`,
  `blocks.go`), `internal/placeholder` (`Parse`, `Render`: extracted from
  `internal/domain/mailtemplate/template.go`, which then uses it with its tests unchanged),
  `internal/pdffonts` (the embedded fonts, adding italic and bold italic; `formpdf.Fonts()` wraps
  it), `internal/docpdf` (draws blocks on pdf-mini's `layout`), later `internal/vault/docx`.
- **Routes:** `cmd/api/document-template-routes.go`, generation in `cmd/api/vault-routes.go`.
- **Migration:** `0063_document_templates`: `vault.templates`, `vault.template_versions`,
  `vault.document_number_counters`, the permission `document_templates.manage` (Administrator).
- **Apps:** Administration's **Document Templates** (`/admin/document-templates`,
  `routes/document-templates.tsx`, rules `lib/document-templates.ts`); the staff app's
  **Generate Document…** on the employee page.

**To check first:** pdf-mini v0.7.0 must offer rich text runs, tables and page breaks in
`layout`. If one is missing, pdf-mini is extended before `internal/docpdf` is written.

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

The editor in Administration (tiptap on ProseMirror, its schema limited to these blocks and
marks) reads and writes this JSON; `lib/document-templates.ts` converts both ways, tested for
round trips. Field chips are inserted from the **Fields** panel; **Add Asked Field** declares an
`input.*` field.

## Fields (`internal/vault/template/fields.go`)

| Field | Value |
| --- | --- |
| `employee.name`, `.first_name`, `.last_name`, `.code`, `.birth_date`, `.nationality` | the employee (People), through the vault's `Subjects` port |
| `company.name`, `.code`, `.vat_code`, `.address`, `.iban` | the company of the chosen employment |
| `employment.from`, `.until`, `.position` | the chosen employment period (`position` once People records it) |
| `document.number`, `.date`, `.hash` | the new document's number, date and (in the footer only) hash |
| `user.name` | who generates it |
| `today` | the day in `API_ORG_TIMEZONE` |
| `input.<key>` | an **asked field** the template declares |

An **asked field** has a key (`[a-z][a-z0-9_]*`), a label in the template's language, a kind
(`text`, `long_text`, `date`, `number`, `money` in euro cents, `choice` with its options) and
whether it is required. The personal code is an asked field in v1 (ADR 0008, open question 2).
Dates and money are written in the template's language (*2026 m. lapkričio 24 d.*).

## Generate

On the employee page, **Generate Document…** (the type's `manage` permission): type → template
→ employment (when the person has several) → asked fields → **Preview** → **Generate**.

1. `POST /api/v1/vault/generate/preview` with `{template_id, employee_id, employment_id,
   inputs}`: resolves every field, draws the PDF with *PREVIEW* in the footer and no number, and
   answers it with `values_hash` (SHA-256 of the canonical values). Nothing is stored or
   recorded. `no-store`.
2. `POST /api/v1/vault/generate` with the same and `values_hash`: resolves again and refuses
   with 409 (`stale`) when the hash differs (a value changed since the preview, as Give refuses
   a stale form hash). Then, in one transaction: takes the next **document number** from
   `vault.document_number_counters` (per type and year: `EC-2026-0001`), computes the document
   hash over the canonical JSON of {type, template id, version, body SHA-256, number, date,
   values}, draws the PDF (`internal/docpdf`, its creation date passed in, so the same input
   draws the same bytes) with the footer *Document <number> v1 · SHA-256 <hash>*, seals it for
   a sealed type, writes the object, then the document (`origin` `generated`), version 1
   (`generated`, the values in `data` or `data_sealed`), the file, links to the employee and the
   company (locked), read text from the blocks (`method` `blocks`) and the event
   `vault.document_generated` (type, template and version, number; never a value).
3. **Upload Signed Copy** on the document adds version 2 (`signed`) with the scanned, signed
   paper; its text is read by the worker (phase 4).

An annex is generated from the contract's page (its `parent_id`), with the contract's employee
and company.

## DOCX templates (phase 8)

Migration `0066`: `template_versions.kind` and `file_id`. **Upload DOCX Template** in
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
| `POST /api/v1/document-templates/{id}/preview` | `document_templates.manage` | sample values; the PDF |
| `GET /api/v1/vault/templates?type=` | the type's `manage` | published templates for Generate |
| `POST /api/v1/vault/generate/preview` | the type's `manage` | the PDF and `values_hash` |
| `POST /api/v1/vault/generate` | the type's `manage` | 409 `stale`; 503 for a sealed type without keys |

## Tests

- `internal/placeholder`: Mail Templates' tests unchanged and passing through it.
- Blocks: strict decoding refuses unknown keys and HTML; the editor's round trips.
- `internal/docpdf`: the same input draws the same bytes; every block kind; long tables break
  across pages.
- Service: publish refuses unknown fields; a published version cannot change; stale
  `values_hash` is 409; numbers never repeat under concurrent generation (Postgres); the event
  holds no value.
- e2e: publish a template, generate a contract, upload its signed copy.
