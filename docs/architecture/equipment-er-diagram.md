# Equipment ER diagram

The tables behind Equipment & Furniture in Company Assets (`internal/domain/asset`, ADR
0004): the item, its assignments and their signed copies, its inventory numbers, and the
role that lets a user see it. An item is an `assets` row with `kind = 'EQUIPMENT'`; SIM
cards share the tables ([sim-card-er-diagram.md](sim-card-er-diagram.md)). Built from
migrations `0029_company_assets`, `0030_asset_signed_copies` and
`0032_equipment_assignments_role`. The rules behind the columns are in
[asset-service.md](../specs/asset-service.md) ("Equipment & Furniture"); the same diagram as a
page is [equipment-er-diagram.html](equipment-er-diagram.html).

Only the columns an item uses are shown: the SIM card's `sim_no`, `phone_no`, `provider`,
`plan`, `connection_status` and `received_date` are always null for one, so equipment has no
status. `employees` and `users` are shown by their keys only. Location, the holder and Days
Held are not columns: they are derived from the open assignment. An item's Changes are
`audit_events` rows with `entity_type = 'asset'` and its id, which no foreign key ties to it.

## Diagram

```mermaid
erDiagram
  assets ||--o{ asset_assignments : "given in"
  assets ||--o| asset_assignments : "held by (open)"
  employees ||--o{ asset_assignments : "holds"
  asset_assignments ||--o{ asset_signed_copies : "signed copies"
  assets ||--|{ asset_numbers : "numbers used"
  asset_number_counters ||..o{ assets : "suggests by category"
  users ||--o{ assets : "created, updated, deleted, written off by"
  users ||--o{ asset_assignments : "given, marked, returned by"
  users ||--o{ asset_signed_copies : "uploaded by"
  users ||--o{ user_roles : "holds"
  roles ||--o{ user_roles : "granted to"
  roles ||--|{ role_permissions : "bundles"

  assets {
    uuid id PK
    text kind "EQUIPMENT"
    text category "COMPUTER PHONE EXTERNAL_DRIVE FURNITURE OTHER"
    text inventory_no UK "PC-000001, FUR-000001"
    text name
    text serial_no "null, not unique"
    bigint non_return_value_cents "null, needed to give on a form"
    text currency "EUR"
    text comment
    timestamptz written_off_at "reserved"
    uuid written_off_by_user_id FK "reserved"
    timestamptz created_at
    uuid created_by_user_id FK
    timestamptz updated_at
    uuid updated_by_user_id FK
    timestamptz deleted_at "soft delete"
    uuid deleted_by_user_id FK
  }

  asset_assignments {
    uuid id PK
    uuid asset_id FK "one open per asset"
    uuid employee_id FK
    date given_date
    uuid given_by_user_id FK
    timestamptz created_at
    text comment
    jsonb form "snapshot, null for furniture and other"
    text form_template_version
    text document_hash "sha256 of the form"
    boolean paper_form_signed
    timestamptz not_returned_at "set once"
    uuid not_returned_by_user_id FK
    text not_returned_comment
    text whereabouts "WITH_EMPLOYEE UNKNOWN"
    date returned_date "null while open"
    timestamptz returned_at
    uuid returned_by_user_id FK
    text return_comment
  }

  asset_signed_copies {
    uuid id PK
    uuid assignment_id FK "only with a form"
    text object_key UK "in the files store"
    text file_name
    text content_type "PDF JPEG PNG"
    bigint size_bytes "up to 10 MB"
    text sha256
    timestamptz uploaded_at
    uuid uploaded_by_user_id FK
  }

  asset_numbers {
    text number UK "every number ever used"
    uuid asset_id FK
    timestamptz created_at
  }

  asset_number_counters {
    text prefix PK "PC PH DRV FUR AST"
    bigint last
  }

  user_roles {
    uuid user_id PK, FK
    uuid role_id PK, FK
  }

  roles {
    uuid id PK
    text key UK "equipment, 0032"
    text name "Equipment Assignments"
  }

  role_permissions {
    uuid role_id PK, FK
    text permission PK "equipment.read"
  }

  employees {
    uuid id PK
  }
  users {
    uuid id PK
  }
```

## Rules the diagram does not show

| Table | Rule | Enforced by |
| --- | --- | --- |
| `assets` | an item has `category` and `name`, and none of a SIM card's columns | CHECK `assets_kind_fields` |
| `assets` | `inventory_no` is unique over every asset, case aside, deleted ones included | UNIQUE index `assets_inventory_no_idx` |
| `assets` | `deleted_at` and `deleted_by_user_id` are set together, as are `written_off_at` and `written_off_by_user_id`; reads leave both out. No route deletes or writes off an asset yet | CHECKs `assets_deleted`, `assets_written_off`, queries |
| `assets` | `currency` is `EUR`; `non_return_value_cents` is not negative | CHECKs |
| `assets` | Computer, Phone and External Drive need a form, and so a value, to be given; Furniture and Other do not | service (`Asset.NeedsForm`, `Give`) |
| `assets` | only a user whose roles grant `equipment.read` sees an item: the register and Add Asset are 403 by kind, a single item 404, and search and the employee's assets leave it out | `cmd/api` (`asset.Sight`, `Service.Seen`) |
| `asset_numbers` | a number used once is never used again, even after a correction | UNIQUE index `asset_numbers_number_idx`; `ppe_app` has no UPDATE or DELETE |
| `asset_number_counters` | one counter per category's prefix: `PC` Computer, `PH` Phone, `DRV` External Drive, `FUR` Furniture, `AST` Other; taking `PREFIX-NNNNNN` by hand raises `last` to it | CHECK, service (`Create`) |
| `asset_assignments` | at most one open assignment per item | partial UNIQUE index `asset_assignments_open_idx` (`WHERE returned_date IS NULL`) |
| `asset_assignments` | never deleted; the giving's columns never change; the Not Returned mark is set once; a returned assignment is closed | trigger `asset_assignments_guard`; `ppe_app` has no DELETE |
| `asset_assignments` | `form`, `form_template_version` and `document_hash` are set together, and only with `paper_form_signed` | CHECK `asset_assignments_form` |
| `asset_assignments` | an item needing a form is given with one and `paper_form_signed`; one needing none with neither | service (`Give`) |
| `asset_assignments` | the printed form's hash must equal the form built at Give | service (`Give`, `ErrFormChanged`) |
| `asset_assignments` | the Not Returned fields and `whereabouts` are set together | CHECK `asset_assignments_not_returned` |
| `asset_assignments` | the return fields are set together and `returned_date >= given_date` | CHECK `asset_assignments_returned` |
| `asset_assignments` | neither date is in the future in the organisation timezone | service |
| `asset_signed_copies` | only an assignment with a form takes one (furniture's is `ErrNoForm`) | service |
| `asset_signed_copies` | never changed or deleted: uploading again adds a row, the newest shown | trigger `asset_signed_copies_guard`; `ppe_app` has no UPDATE or DELETE |
| `asset_signed_copies` | a PDF, JPEG or PNG of 1 byte to 10 MB, with a 64-hex SHA-256 | CHECKs; the type read from the file's first bytes by the service |
| `roles` | Equipment Assignments is built in (fixed id, key `equipment`) and the only role granting `equipment.read`, which Administrator does not have | migration 0032, `role.builtinRoles` |
| `employees` | an employee holding an item cannot be deleted | service (`employee.ErrHoldsAssets`) |

Indexes for reading: `assets_kind_idx` on `kind, upper(inventory_no)` for live assets,
`asset_assignments_asset_idx` on `asset_id, given_date DESC` (an item's assignments, newest
first), `asset_assignments_employee_idx` on `employee_id`, `asset_signed_copies_assignment_idx`
on `assignment_id, uploaded_at DESC`, and `user_roles_role_idx` on `role_id`.
