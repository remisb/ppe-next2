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
| `GET /api/v1/sizes` | any authenticated | size vocabulary for the dropdowns (below) |
| `POST /api/v1/orders/resolve` | any authenticated | `{employee_id, lines: [{catalogue_item_id, quantity}]}` |
| `GET /api/v1/item-sets/{id}/apply/{employeeID}` | any authenticated | Apply Item Set; 404 if the set is inactive or deleted |

Both return `{employee, lines, orderable}`. Per line:

- **Size**: CLOTHING uses the saved clothing size, else a height suggestion when exactly
  one interval matches (`size_suggested`); SHOES uses the saved shoe size only; NONE is
  null. No size → `size_missing: true` (not an error; the line is kept). A line's size is
  a string code; a clothing size is the EU number as a string (`"54"`).
- **Price / service period** from the current catalogue; either missing → `price_missing`.
- **`unavailable`**: the item is inactive or deleted.
- Repeated items are merged into one line with summed quantity (one line per item).
- Quantity must be an integer ≥ 1 (400; a non-integer fails JSON decoding).

The vocabulary (`internal/domain/size`), smallest first: clothing `{code, band, min_cm, max_cm}`,
the even EU sizes 44–66; shoes `{code}`, 39–46. Only six clothing sizes carry a height band
(`min_cm`/`max_cm`, inclusive; `null` on the others, which are valid but never suggested),
and a height outside 160–200 cm suggests nothing:

| Height (cm) | 160–167 | 168–175 | 176–181 | 182–187 | 188–193 | 194–200 |
| --- | --- | --- | --- | --- | --- | --- |
| Suggested size | 46 | 50 | 54 | 58 | 62 | 66 |

`band` is the letter size covering two EU sizes: S (44–46), M (48–50), L (52–54),
XL (56–58), 2XL (60–62), 3XL (64–66). Every clothing size picker in the app (Edit Sizes,
the employee form, a Create Order line) offers these six bands and stores the band's larger
size, the one a height suggests. A saved size that is the band's smaller one (44, 48, …)
shows as its band and is kept unless the user picks another band.

Clothing 44 and 46 are also shoe sizes; sizes are always checked against the line's size
group, never guessed from the value.

Clients never send sizes to resolution. The client keeps sizes the user chose by hand and
compares them with a fresh resolution when Assigned to changes (manual §4.1).

### Changing a size on a Create Order line

When the user picks a shoe or clothing size on a line (the inline picker), the line takes it
as a hand-picked size. If it differs from the employee's saved size for that group — including
when the employee has none saved, and when it only repeats the size suggested from height —
the app shows a pop-up:

> Different size selected. Save it to employee profile?

with two buttons, **Save** and **Skip size update**:

- **Save** saves it as the employee's size for that group (`PUT /api/v1/employees/{id}/sizes`,
  the other two values unchanged; audited as `employee.sizes_changed`). The line, and every
  other line of the same group still missing a size, then takes it as a saved size.
- **Skip size update** closes the pop-up; the size applies to this order only and the employee
  is not changed.

Picking the employee's saved size, or clearing the size, shows no pop-up. The pop-up is shown
once per change, so it asks again when the size is changed again. Either way the line keeps the
size picked, and Mark as Ordered snapshots it.
