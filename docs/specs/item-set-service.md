# Item Set service and Create Order resolution

Item Sets: `internal/domain/itemset`, routes in `cmd/api/itemset-routes.go`, tables from
migration `0005_item_sets`. Resolution: `internal/domain/order/resolve.go`, routes in
`cmd/api/order-routes.go`. Manual §3.1, §3.4, §4.2–4.4 and algorithm A.

## Item Set

A reusable list of `catalogue_item_id` + `default_quantity` + `display_order`. A set never
stores sizes, prices or service periods.

| Field | Notes |
| --- | --- |
| `name` | Required; unique among live sets, case-insensitive |
| `description` | Optional |
| `active` | Required in request bodies; only active sets appear in Create Order |
| `lines` | ≥ 1; each item at most once; quantity ≥ 1. Request order is display order |

Lines must reference live catalogue items (400 otherwise). Inactive items are allowed: a
set can outlive an item's activation, and applying it flags that line instead.

| Route | Access |
| --- | --- |
| `GET /api/v1/item-sets`, `/active`, `/{id}` | any authenticated |
| `POST`, `PUT /{id}` (full replace incl. lines), `DELETE /{id}` (soft) | admin, manager |

## Resolution (algorithm A)

Nothing is stored; these routes only read current data.

| Route | Access | |
| --- | --- | --- |
| `GET /api/v1/sizes` | any authenticated | size vocabulary for the dropdowns |
| `POST /api/v1/orders/resolve` | any authenticated | `{employee_id, lines: [{catalogue_item_id, quantity}]}` |
| `GET /api/v1/item-sets/{id}/apply/{employeeID}` | any authenticated | Apply Item Set; 404 if the set is inactive or deleted |

Both return `{employee, lines, orderable}`. Per line:

- **Size**: CLOTHING uses the saved clothing size, else a height suggestion when exactly
  one interval matches (`size_suggested`); SHOES uses the saved shoe size only; NONE is
  null. No size → `size_missing: true` (not an error; the line is kept).
- **Price / service period** from the current catalogue; either missing → `price_missing`.
- **`unavailable`**: the item is inactive or deleted.
- Repeated items are merged into one line with summed quantity (one line per item).
- Quantity must be an integer ≥ 1 (400; a non-integer fails JSON decoding).

Clients never send sizes to resolution. The client keeps sizes the user chose by hand and
compares them with a fresh resolution when Assigned to changes (manual §4.1).
