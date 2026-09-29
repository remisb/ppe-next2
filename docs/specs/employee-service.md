# Employee service

People workwear is ordered for, and their reusable size defaults. Package
`internal/domain/employee`, routes in `cmd/api/employee-routes.go`, table from migration
`0003_employees` (clothing size made numeric by `0012_numeric_clothing_size`, preferred
language added by `0017_employee_language`). Manual §3.2
and §4.1.

## Entity

| Field | Notes |
| --- | --- |
| `first_name`, `last_name` | Required (Add New Employee needs nothing else) |
| `code` | Optional; unique among live employees, case-insensitive |
| `height_cm` | Optional, 100–250; used only to *suggest* a clothing size |
| `clothing_size` | Optional EU size, a JSON number: even, 44–66 (else 400 "is not a known clothing size"; a string is refused) |
| `shoe_size` | Optional: 39–46 |
| `notes` | Optional free text |
| `preferred_language` | Optional: `en`, `lt` or `ru`, the languages the app speaks (else 400); `null` when not recorded. A CHECK in migration `0017_employee_language` holds it too. Update replaces every field, so a PUT without it clears it. The confirmation page and hand-over mode open in it when it is `en` or `ru` (order records carry it as `employee_language`) |
| `full_name` | Derived, response only |

There is no glove size: gloves and similar PPE are no-size items.

Sizes are **defaults for future orders**. Orders snapshot the size they used, so editing an
employee never alters an existing order.

Clothing sizes were letters (S … 3XL) until migration 0012, which converted saved sizes
S→46, M→50, L→54, XL→58, 2XL→62, 3XL→66. Order lines are immutable and keep the letters
they were ordered in; new lines hold the number as a string code (`"54"`). Audit events
written before 0012 likewise keep `clothing_size` as a letter string.

## Routes

| Route | Access | Kind |
| --- | --- | --- |
| `GET /api/v1/employees` | any authenticated | list |
| `GET /api/v1/employees/{id}` | any authenticated | 404 on miss |
| `GET /api/v1/employees/by-name/{q}` | any authenticated | **filter** (Assigned to search): matches first, last, full name or code, case-insensitive substring, max 50; no match is `200 []` |
| `POST /api/v1/employees` | any authenticated | body: all entity fields except derived |
| `PUT /api/v1/employees/{id}` | any authenticated | full replace of the same body |
| `PUT /api/v1/employees/{id}/sizes` | any authenticated | Edit Sizes / Save as Employee Default: `{height_cm, clothing_size, shoe_size}`, all three replaced |
| `DELETE /api/v1/employees/{id}` | admin, manager | soft delete |

## Audit

`employee.created` (after = sizes), `employee.sizes_changed` (before/after sizes, only when a
size default actually changes, from either PUT), `employee.deleted`. Each event is written
in the same transaction as the change, from the row read under `FOR UPDATE`.
