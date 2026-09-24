# Employee service

People workwear is ordered for, and their reusable size defaults. Package
`internal/domain/employee`, routes in `cmd/api/employee-routes.go`, table from migration
`0003_employees`. Manual §3.2 and §4.1.

## Entity

| Field | Notes |
| --- | --- |
| `first_name`, `last_name` | Required (Add New Employee needs nothing else) |
| `code` | Optional; unique among live employees, case-insensitive |
| `height_cm` | Optional, 100–250; used only to *suggest* a clothing size |
| `clothing_size` | Optional: S, M, L, XL, 2XL, 3XL (input is upper-cased) |
| `shoe_size` | Optional: 39–46 |
| `notes` | Optional free text |
| `full_name` | Derived, response only |

There is no glove size: gloves and similar PPE are no-size items.

Sizes are **defaults for future orders**. Orders snapshot the size they used, so editing an
employee never alters an existing order.

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
