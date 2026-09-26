# Dashboard service

Three read-only dashboards, each for its role alone. The administrator's overview: `internal/domain/dashboard`, route in
`cmd/api/dashboard-routes.go`. It owns no table and writes nothing; it reads orders,
order lines, employees, catalogue items, item sets and users in one read-only
`REPEATABLE READ` transaction, so its figures agree with each other.

| Route | Access |
| --- | --- |
| `GET /api/v1/dashboard` | admin |
| `GET /api/v1/dashboard/manager` | manager (not admin: the administrator has their own) |
| `GET /api/v1/dashboard/employee` | employee (not admin or manager); covers the signed-in user |

In the web app each is its role's start screen: the Dashboard (`/dashboard`) for
administrators, the Manager Dashboard (`/manager`) for managers, the Employee Dashboard
(`/my-orders`) for the employee role, Create Order for a user with none of these; `/` and
any dashboard's address show the signed-in user's own. A user with several roles starts on
the first of admin, manager, employee, and opens the others' dashboards from its header.

## Figures

Money, items and names of orders come from the order snapshots, as in History; only the
setup counts read live master data. Months and day counts follow the organisation's
calendar (`API_ORG_TIMEZONE`); timestamps stay UTC.

| Field | Meaning |
| --- | --- |
| `awaiting` | Every ORDERED order: count, value, age of the oldest in calendar days, and the 8 longest waiting |
| `months` | 12 calendar months, oldest first, the current one last, zeros included. Ordered figures count orders by `ordered_at`, given figures by `given_at`, so one order can count in two months |
| `confirmation` | Orders given in the last 90 days: count, electronic vs paper, median days from ordered to given (one decimal) |
| `top_items` | The 8 items with the largest quantity given over the 12 months, by catalogue item, named as on their latest receipt |
| `replacements` | For each live employee and item, the most recent GIVEN line, due at `given_at` + its service period. Listed when due within 30 days (`overdue` when due now or earlier), unless the item is already on an ORDERED order for that employee. Counts, and the 8 soonest due |
| `setup` | Live employees and those missing a size (no shoe size, or neither a clothing size nor a height), active catalogue items and those without a price or service period (Mark as Ordered refuses them), active item sets, active users and administrators |

Lists are `[]`, never null; an empty database gives a complete dashboard.

## Manager Dashboard

Items, prices and purchasing. Ordered figures come from the order snapshots; prices,
the catalogue, item sets and sizes are live, since the manager maintains them.

| Field | Meaning |
| --- | --- |
| `on_order` | Every ORDERED order: orders, items and value, ordered but not yet given out |
| `months` | 12 calendar months by `ordered_at`: orders, items, value |
| `spend_by_item` | The 8 items with the largest value ordered over the 12 months |
| `forecast` | Replacements due within 90 days, overdue included, by the same rule as the administrator's (latest GIVEN line per live employee and item, not already on an ORDERED order), grouped by item: the same quantity again, costed at the item's current price when it is active and complete. Totals cover every item; `lines` keeps the 8 largest |
| `price_changes` | The 8 newest `catalogue.price_changed` audit events of the 12 months: price and service period before and after, who and when |
| `catalogue` | Active and inactive counts; active items without a price or service period; active, priced items on no order in the 12 months |
| `item_sets` | Active sets with a line whose item is inactive, deleted, or has no price or service period |
| `sizes` | Live employees per clothing size (saved, or suggested from height as in Create Order) and shoe size, in vocabulary order with zeros; how many have none, and how many clothing sizes are suggested |

## Employee Dashboard

For the employee role, the staff who prepare orders. "Your" orders are those the signed-in
user marked as ordered (`prepared_by_user_id`); replacements and missing sizes cover the
whole organisation, since any preparer may order for anyone.

| Field | Meaning |
| --- | --- |
| `awaiting` | The user's ORDERED orders: orders, items, value, oldest age; how many have no confirmation link (`no_link`) or only an expired or revoked one (`link_expired`); the 8 longest waiting, each with `link` `NONE`/`ACTIVE`/`EXPIRED` from its latest electronic confirmation row and the active link's expiry |
| `months` | 12 calendar months of the user's orders: ordered by `ordered_at`, given (orders and items) by `given_at` |
| `recently_given` | The user's 8 most recently given orders: employee, date, method, items, value, record number |
| `replacements` | As on the administrator's dashboard |
| `missing_sizes` | Live employees without a shoe size, or without both a clothing size and a height: the count and the first 8 by name, with what is missing |
