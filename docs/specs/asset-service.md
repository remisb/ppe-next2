# Asset service (Company Assets)

**Status: planned.** Nothing here is built yet; this is the target for slices 2–7 of
[ADR 0004](../architecture/adr/0004-company-assets.md). The product contract is the assets
brief, `../PPE-documents/GAVORT_SIM_ir_inventoriaus_apskaitos_uzduotis.pdf` (v1.0,
2026-10-08); § numbers below point to it. Terms are in
[ubiquitous-language.md §12](../ubiquitous-language.md#12-company-assets). The screens are
in the [Company Assets UX review](../ux/company-assets-ux-review.md).

Where the brief leaves a rule open, this spec does not invent one: the rule is listed under
[Open decisions](#open-decisions) with the default the build will use until it is decided,
and the code keeps that default in one place.

Package `internal/domain/asset` (the flat layout of today's domains; it moves with the
others if ADR 0001 is accepted), routes in `cmd/api/asset-routes.go`.

## Rules the service enforces (§2)

1. One asset is one physical item. A SIM card's SIM No. and Phone No. are separate fields.
2. Connection status, location and holder are separate facts. No action changes one of them
   as a side effect of another: Change Status never moves an asset, and giving or returning
   never changes the status.
3. An asset has at most one open assignment. A partial unique index enforces it, so two
   users giving the same card at once cannot both succeed.
4. Nothing returns an asset except Register Return: not an employee leaving, not Mark as Not
   Returned, not Blocked.
5. Each action is one request in one transaction, writing the asset or assignment and its
   audit events together. A failure leaves nothing behind (§7).
6. Location, office stock, With Employees and Days Held are derived from assignments and are
   never stored, so they cannot disagree.

## Entities

### Asset — table `assets`

| Field | Notes |
| --- | --- |
| `id` | UUID |
| `kind` | `SIM` or `EQUIPMENT` |
| `category` | EQUIPMENT only: `COMPUTER`, `PHONE`, `EXTERNAL_DRIVE`, `FURNITURE`, `OTHER` (§15); null for SIM |
| `inventory_no` | Required. Unique over every asset ever created; see [Numbers](#numbers) |
| `name` | EQUIPMENT: required. SIM: null (a card is named by its numbers) |
| `serial_no` | EQUIPMENT, optional. Not unique (§15 does not ask for it) |
| `sim_no` | SIM: required, text, stored as typed after trimming outer spaces, so leading zeros stay (§4). Unique among assets not soft-deleted, compared with spaces removed |
| `phone_no` | SIM, optional at registration (§4); needed to give |
| `provider` | SIM: required |
| `plan` | SIM, optional at registration; needed to give |
| `non_return_value_cents`, `currency` | Optional at registration; needed to give when the asset needs a form. Currency is the organisation's (`EUR`, as for the catalogue) |
| `connection_status` | SIM only: `NOT_ACTIVATED` (default), `ACTIVE`, `BLOCKED`. Null for EQUIPMENT (§17) |
| `received_date` | SIM: the date it arrived from the provider, default today in the organisation timezone |
| `comment` | Optional free text, up to 2000. Also where another location is noted (§3) |
| `written_off_at`, `written_off_by_user_id` | Reserved for write-off, not used until it is decided |
| `created_*`, `updated_*`, `deleted_*` | As every table; soft delete is for an asset registered by mistake and refused while it has any assignment |

### Assignment — table `asset_assignments`

| Field | Notes |
| --- | --- |
| `id`, `asset_id`, `employee_id` | `employee_id` references `employees` (the shared kernel) |
| `given_date` | The actual date, a calendar day; not in the future in the organisation timezone; earlier is allowed (§10) |
| `given_by_user_id`, `created_at` | Who registered it and when it was typed in, kept apart from `given_date` (§10) |
| `comment` | Optional |
| `form` | JSONB snapshot of the assignment form's data, null when the asset's category needs no form; never changes |
| `form_template_version`, `document_hash` | As the order record's `receipt_text_version` and hash: SHA-256 of the form's canonical JSON |
| `paper_form_signed` | True when given with a form (giving requires it) |
| `signed_copy_file_id`, `signed_copy_uploaded_*` | The scan, slice 5; null is **Signed Copy Missing** |
| `not_returned_at`, `not_returned_by_user_id`, `not_returned_comment`, `whereabouts` | The Not Returned mark; `whereabouts` is `WITH_EMPLOYEE` or `UNKNOWN` |
| `returned_date`, `returned_by_user_id`, `returned_at`, `return_comment` | Null while open. `returned_date` is not before `given_date` and not in the future |

Partial unique index: `(asset_id) WHERE returned_date IS NULL`. A CHECK keeps the Not
Returned fields all set or all null, and `whereabouts` set only with them. Assignments are
never deleted or overwritten. Only the return, Not Returned and signed-copy columns are set
later, each once.

### Derived values

| Value | Rule |
| --- | --- |
| Location | No open assignment: `OFFICE`. Open: `WITH_EMPLOYEE`, or `UNKNOWN` when marked Not Returned with whereabouts `UNKNOWN` |
| Holder | The open assignment's employee, also when Unknown (the last holder, §13) |
| Days Held | Whole calendar days in the organisation timezone from `given_date` to `returned_date`, or to today while open. Given today is 0 |
| Summary (§3) | **Total** = live assets of the kind, not written off; **In Office** = no open assignment; **With Employees** = open assignments; **Not Returned** = open and marked. They overlap and are never summed |

## Numbers (§16)

Counters per prefix in `asset_number_counters`: `SIM` for SIM cards, then by category `PC`
(Computer), `PH` (Phone), `DRV` (External Drive), `FUR` (Furniture), `AST` (Other). The form
suggests the next `PREFIX-000001`. Staff may type the company's own number instead. Every
number used is recorded in `asset_numbers` (unique), so a number is never given to a second
asset, even after a correction or a soft delete. The counter skips numbers already taken.
The system never changes a number by itself.

A duplicate answers 409 with the existing asset's id, and the form shows *This SIM number is
already registered. Open the existing SIM card.* (§4) with a link. The same goes for an
inventory number.

## Actions

Every write needs `assets.manage`. Reads need sign-in, like employees and orders.

### Add SIM Card, Add Asset (§4, §15)

One form, one asset at a time; no bulk entry. SIM defaults: Office, Not Activated, Received
Date today, the next SIM number; **Active** may be chosen when the card is already active.
SIM requires SIM No., Provider, Received Date and Inventory No.; Phone No., Plan and value may
be unknown yet. EQUIPMENT requires Name, Category and Inventory No. Event `asset.registered`.

Registering an asset an employee already holds goes through Register Existing Assignment
(open decision), never by adding it to the Office.

### Edit

Details only: numbers, provider, plan, value, name, serial, comment. Never status, location or
holder. Event `asset.updated` with the changed fields. A plan or value change never touches
an existing assignment's form (§8, §19).

### Change Status (§5)

SIM only. Any of the three statuses to any other, saved at once with no confirmation step.
Event `asset.status_changed` with the old and new status. Changing to the same status is a
no-op that writes nothing. The holder and location stay as they are.

### Give SIM Card, Give Asset (§6, §7, §17)

Request: employee, given date, comment, the missing plan or value if the asset lacks them,
`paper_form_signed`, and `form_hash`, the document hash of the form preview that was printed.

In one transaction the repository locks the asset `FOR UPDATE` and the service checks, in
this order, answering the first that fails:

| Check | Answer |
| --- | --- |
| Asset live and not written off | 404 |
| No open assignment | 409 `ErrAlreadyGiven`: *This SIM card has already been given to another employee. Select another SIM card.* (§7) |
| SIM: status Active | 409 `ErrNotActive`, saying Not Activated or Blocked; a returned blocked card must be unblocked with the provider and set Active first (§12) |
| Employee live | 404 |
| Form data complete (SIM: Phone No., Plan, value; EQUIPMENT needing a form: value) | 400, naming the field |
| Given date not in the future | 400 |
| Form needed: `paper_form_signed` true | 400 |
| Form needed: `form_hash` equals the hash of the form built now | 409 `ErrFormChanged`: print the updated form |

Then it saves any plan or value filled in on the asset, inserts the assignment with the
form snapshot and hash, and records `asset.given` (and `asset.updated` when the asset changed).
The answer carries the employee's name for *SIM card given to [Employee Name].* A second
click or a second user meets the unique index or the lock and gets the 409; nothing partial
remains (§7).

`POST /api/v1/asset-assignments/preview` builds the form and its hash from the same request
without writing, for Preview Form and Print Form. Printing or previewing is not giving (§8).

### Register SIM Return, Register Asset Return (§11)

Request: return date (default today, not before the given date, not in the future) and an
optional comment. Sets the return fields on the open assignment; the asset is in the Office
again. The status does not change. The Not Returned mark, the form and the signed copy stay
on the assignment. Event `asset.returned`. Returning an asset with no open assignment is
409.

### Mark as Not Returned (§13)

Request: whereabouts (`WITH_EMPLOYEE` or `UNKNOWN`) and a comment. Sets the mark on the open
assignment once. The asset stays with its holder and out of office stock. Event
`asset.marked_not_returned`.

### Prepare Blocking Email (§14)

Built in the web app from the asset, its provider's contact and the company name; there is no
route, and nothing is sent or changed. Subject `SIM blocking request - [Phone Number]`; body as
§14 gives it.

### Upload Signed Form (§9, slice 5)

A scan or photo for one assignment, now or later, through the Files platform (ADR 0004).
Event `asset.signed_copy_uploaded`. The copy stays with its assignment when the asset later
goes to someone else.

## Routes

| Route | Access | Kind |
| --- | --- | --- |
| `GET /api/v1/assets` | authenticated | paged search, query parameters (see below) |
| `GET /api/v1/assets/summary/{kind}` | authenticated | the four tile counts |
| `GET /api/v1/assets/{id}` | authenticated | the asset with its derived location, holder and open assignment; 404 |
| `GET /api/v1/assets/by-number/{q}` | authenticated | **filter** for ⌘K Search: SIM No., Phone No. or Inventory No., spaces ignored, max 20; no match is `200 []` |
| `GET /api/v1/assets/next-number/{prefix}` | `assets.manage` | the suggested Inventory No. |
| `POST /api/v1/assets` | `assets.manage` | Add SIM Card, Add Asset |
| `PUT /api/v1/assets/{id}` | `assets.manage` | Edit, full replace of the details |
| `PUT /api/v1/assets/{id}/status` | `assets.manage` | Change Status |
| `GET /api/v1/assets/{id}/assignments` | authenticated | the asset's assignments, newest first |
| `POST /api/v1/assets/{id}/assignments` | `assets.manage` | Give |
| `POST /api/v1/asset-assignments/preview` | `assets.manage` | form and hash, no write |
| `GET /api/v1/asset-assignments/by-employee/{id}` | authenticated | **filter**: the employee's assignments, open first |
| `GET /api/v1/asset-assignments/{id}/form` | authenticated | the stored form, for reprinting |
| `POST /api/v1/asset-assignments/{id}/return` | `assets.manage` | Register Return |
| `POST /api/v1/asset-assignments/{id}/not-returned` | `assets.manage` | Mark as Not Returned |
| `GET /api/v1/audit-events/assets/{id}` | authenticated | the asset's Changes, as for the other records |

`GET /api/v1/assets` takes query parameters, the
[contract's exception](../domain-service-contract.md) for paged search lists, which slice 2
adds to the contract's list beside `GET /api/v1/orders`: `kind` (required), `q` (SIM No.,
Phone No., Inventory No. or employee name), `location`, `employee_id`, `provider`, `status`,
`not_returned`, `signed_copy`, `sort`, `dir`, `page`, `page_size`. Anything else is 400, and
no match is an empty page.

## Audit

Entity type `assets`, entity id the asset's, so an asset's Changes show its whole story:
`asset.registered`, `asset.updated`, `asset.status_changed`, `asset.given`, `asset.returned`,
`asset.marked_not_returned`, `asset.signed_copy_uploaded`. Assignment events name the
assignment and employee ids and the dates. Each goes into `audit.Events()` and
`AUDIT_EVENTS`, and gets its words in `@ppe/audit`.

## The assignment form (§8)

A form kind per asset kind or category (SIM, computer equipment). Each has versioned
templates, like the record's wording versions, so a template can be added or reworded
without changing the process. The SIM form carries the employee's and the company's details
(per template), SIM No., Phone No., Inventory No., provider, plan, non-return value and
currency, the given date and signature lines. The stored form is built only from the
snapshot. Until the company supplies the templates, a plain layout with these fields is used
and marked as such.

The web form clears Paper Form Signed and asks for a reprint when the employee, asset, date or
form data change after Print Form. The server's `form_hash` check makes the same rule hold
for any client.

## Open decisions

| # | Question | Brief | Default until decided |
| --- | --- | --- | --- |
| 1 | Employees have no "no longer working" state; the brief assumes one. Add it? May an employee holding assets be deleted? | §2, §13 | No new state; Delete employee is refused while they hold an open assignment, naming the assets |
| 2 | Where signed copies are stored and backed up, and their size and type limits. The brief says "existing rules", but none exist | §9 | Slice 5 waits for the decision; ADR 0001 points to Spaces |
| 3 | Company name and details for forms and the blocking email | §8, §14 | A Settings field, set by `settings.manage` |
| 4 | Providers' contacts and plans | §5, §14, §20 | Provider and plan are free text; a provider's e-mail is a Settings list |
| 5 | Which built-in roles get `assets.manage`; whether Change Status needs its own permission | §18 | Administrator and Manager; one permission |
| 6 | Which equipment categories need a form; whether furniture does | §17 | Computer, Phone, External Drive need one; Furniture and Other do not |
| 7 | Correcting a wrong Not Returned mark, status or whereabouts | none | Status: Change Status again. The Not Returned mark cannot be removed; Register Return ends it |
| 8 | Write-off and loss | §18, §20 | Not built; `written_off_*` reserved |
| 9 | Register Existing Assignment for assets already held at go-live, with an unknown date and no form | §20 | Needed before go-live; specified when decided |
| 10 | Office stock reconciliation | §20 | Not built |
| 11 | Exact form templates | §8, §17 | The plain layout above |
