# Order ER diagram

The tables of the Order aggregate (`internal/domain/order`): the order, its immutable
snapshot lines and its confirmations, with the live tables they point at. Built from
migrations `0006_orders`, `0007_order_confirmations`, `0009_in_person_confirmation`,
`0013_receipt_text_version`, `0015_order_soft_delete`, `0021_purchase_price` and
`0027_usage`. The rules behind the columns are in
[order-service.md](../specs/order-service.md); the same diagram as a page is
[order-er-diagram.html](order-er-diagram.html).

`employees`, `catalogue_items` and `users` are shown by their keys only. Nothing an order
or its record shows is read from them: names, prices and sizes are copied in at Mark as
Ordered.

## Diagram

```mermaid
erDiagram
  employees ||--o{ orders : "ordered for"
  users ||--o{ orders : "prepared, given, updated, deleted by"
  orders ||--|{ order_lines : "has (immutable)"
  catalogue_items ||--o{ order_lines : "copied from"
  orders ||--o{ order_confirmations : "confirmed through"
  users ||--o{ order_confirmations : "created by"

  orders {
    uuid id PK
    bigint record_seq UK "order_record_seq, WE-000123"
    uuid employee_id FK
    text employee_first_name "snapshot"
    text employee_last_name "snapshot"
    text employee_code "snapshot, null"
    text status "ORDERED or GIVEN"
    timestamptz ordered_at
    uuid prepared_by_user_id FK
    text prepared_by_name "snapshot"
    timestamptz given_at "set only when GIVEN"
    uuid given_by_user_id FK "set only when GIVEN"
    text given_by_name "set only when GIVEN"
    text confirmation_method "ELECTRONIC PAPER IN_PERSON"
    text receipt_text_version "wording, 0013"
    timestamptz updated_at
    uuid updated_by_user_id FK
    timestamptz deleted_at "soft delete, 0015"
    uuid deleted_by_user_id FK
  }

  order_lines {
    uuid id PK
    uuid order_id FK
    int line_no "unique per order"
    uuid catalogue_item_id FK "unique per order"
    text item_name
    text item_details
    text size_group "CLOTHING SHOES NONE"
    text size "null when NONE"
    int quantity "at least 1"
    bigint accounting_price_cents "shown and totalled"
    bigint purchase_price_cents "null, 0021"
    text currency "EUR"
    int service_period_months "over 0"
  }

  order_confirmations {
    uuid id PK
    uuid order_id FK
    text method "ELECTRONIC PAPER IN_PERSON"
    text token_hash UK "sha256, ELECTRONIC only"
    timestamptz expires_at "ELECTRONIC only"
    timestamptz revoked_at
    timestamptz first_opened_at "0027"
    timestamptz confirmed_at "evidence"
    text confirmed_name "evidence"
    text document_hash "evidence"
    timestamptz created_at
    uuid created_by_user_id FK
  }

  employees {
    uuid id PK
  }
  catalogue_items {
    uuid id PK
  }
  users {
    uuid id PK
  }
```

## Rules the diagram does not show

| Table | Rule | Enforced by |
| --- | --- | --- |
| `orders` | `status` is `ORDERED` or `GIVEN`; there is no draft row | CHECK |
| `orders` | `given_at`, `given_by_user_id`, `given_by_name` and `confirmation_method` are all set exactly when `status = 'GIVEN'` | CHECK `orders_given_fields` |
| `orders` | `deleted_at` and `deleted_by_user_id` are set together; every read filters `deleted_at IS NULL` | CHECK `orders_deleted_fields`, queries |
| `orders` | `record_seq` comes from `order_record_seq`; a rolled-back or deleted order leaves a gap, never reused | sequence, UNIQUE |
| `order_lines` | never updated, deleted or truncated | triggers `order_lines_no_update_delete`, `order_lines_no_truncate` (0026) |
| `order_lines` | one line per catalogue item and one per line number in an order | UNIQUE `(order_id, catalogue_item_id)`, `(order_id, line_no)` |
| `order_lines` | `size` is null exactly when `size_group = 'NONE'` | CHECK `order_lines_size_matches_group` |
| `order_lines` | `catalogue_item_id` is for reporting only; every displayed value is copied | service (`MarkAsOrdered`) |
| `order_confirmations` | `ELECTRONIC` has `token_hash` and `expires_at`; `PAPER` and `IN_PERSON` have neither | CHECK `order_confirmations_token_shape` |
| `order_confirmations` | `confirmed_at`, `confirmed_name` and `document_hash` are set together | CHECK `order_confirmations_evidence` |
| `order_confirmations` | at most one confirmation per order carries evidence | partial UNIQUE index `order_confirmations_one_confirmed_idx` |
| `order_confirmations` | only the SHA-256 of a link's token is stored | service (`HashToken`) |

Indexes for reading: `orders_activity_idx` on `coalesce(given_at, ordered_at) DESC, id`
(newest activity first), `orders_employee_idx` on `employee_id`, and
`order_confirmations_order_idx` on `order_id`.
