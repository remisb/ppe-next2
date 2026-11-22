# Company service

The organisation's own companies, which employees are employed by
([employee-service.md](employee-service.md), "Employment"). Package `internal/domain/company`,
routes in `cmd/api/company-routes.go`, table `companies` from migration `0057_companies`.
Administration's **Companies** screen manages them (`web/apps/admin/src/routes/companies.tsx`,
rules `src/lib/companies.ts`); the staff app's Add New Employee, Employ… and Move to Another
Company… choose one.

One live company at most is the **default company**: Add New Employee chooses it first (another
may be chosen), and mail templates write its name where they use `{{company.name}}`
([mail-template-service.md](mail-template-service.md)). It replaced Settings' Company name
(migration 0057, below).

## Entity

| Field | Notes |
| --- | --- |
| `code` | **Internal code**: optional, at most 32 characters; when set, unique among live companies case-insensitively (`companies_code_live_idx`, which leaves out empty codes) |
| `name` | Required, at most 200 characters, trimmed with inner spaces collapsed. Not unique |
| `company_code` | The registration number (*įmonės kodas*); optional, at most 50 |
| `vat_code` | VAT payer's code; optional, at most 50; saved in upper case without spaces |
| `address` | Optional, at most 300 |
| `city` | Optional, at most 100 |
| `postal_code` | Optional, at most 20 |
| `country` | ISO 3166-1 alpha-2 (`LT`), or empty; saved in upper case |
| `notes` | Optional, at most 2000 |
| `is_default` | The default company; response only, changed by Make Default. `companies_default_idx` allows one live default, and `companies_default_live` refuses a deleted default |
| `employee_count` | Live employees employed by it now (an open employment); response only |
| `created_at`, `updated_at`, actors | Set by the service; response only |

Request bodies may send only `code` … `notes` (`DisallowUnknownFields`): `is_default`,
`employee_count`, timestamps and actors are refused (400).

## Rules

- **The first company is the default.** Add Company while no live company is the default
  makes the new one it (`company.created`'s after says `is_default: true`). Two first companies
  at once meet in `companies_default_idx`; the second is added as not the default
  (`ErrDefaultTaken`, retried once).
- **Make Default** moves the default in one transaction under an advisory lock
  (`companies.default`): the previous default stops being it, then this one becomes it. Making
  the default the default records nothing.
- **Delete** is soft. It refuses the default company (`ErrIsDefault`, 409: make another the
  default first) and a company that employs anyone now (`ErrInUse`, 409: end or move their
  employment first). The count is read after the company's row lock; opening an employment
  share-locks the company's row, so the two cannot pass each other. Past employments keep naming
  a deleted company, and its code is free again.

## Routes

| Route | Access |
| --- | --- |
| `GET /api/v1/companies` | any authenticated (Add New Employee offers them): every live company, the default first, then by name |
| `GET /api/v1/companies/{id}` | any authenticated; 404 for an unknown or deleted company |
| `POST /api/v1/companies` | `companies.manage`; 201 with `Location`; 409 for a live company's code |
| `PUT /api/v1/companies/{id}` | `companies.manage`; full replace of the fields above; 409 for another live company's code |
| `PUT /api/v1/companies/{id}/default` | `companies.manage`: Make Default; returns the company |
| `DELETE /api/v1/companies/{id}` | `companies.manage` (soft); 204; 409 for the default or a company employing anyone |

**Manage Companies** (`companies.manage`, group Administration, migration 0057) is the built-in
Administrator's; other roles get it on Roles & permissions. It opens Administration (it is in
`ADMINISTRATION_PERMISSIONS`).

## From Settings' Company name (migration 0057)

The migration creates the first company, the default, when `app_settings.company_name` was set
or any employee exists: named the old Company name, or `Company` when it was empty, attributed
to whoever last saved Settings' name, else to whoever added the first employee. It then drops
`app_settings.company_name`. Its down migration puts the column back from the default company
(not when it is named `Company`). Migration 0058 then employs every live employee there
([employee-service.md](employee-service.md), "Employment").

## Mail templates

`assetMailer` (`cmd/api/checkers.go`) fills `company.name` from `company.Service.Default`; with
no company yet the email shows `[Company Name]` and the sheet says there is no default company.

## Audit

Entity type `company`, area `settings`; the Audit log names a company by its current name,
marked deleted when it is.

| Event | Payload |
| --- | --- |
| `company.created` | after: every field but the notes, and `is_default: true` for the first |
| `company.updated` | the changed fields, before and after; changed notes are `notes_changed: true` |
| `company.made_default` | before: `previous_default`, the old default's name (none for the first); after: `name` |
| `company.deleted` | before: `code` and `name` |
