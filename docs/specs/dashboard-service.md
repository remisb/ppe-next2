# Dashboard service

Two read-only dashboards, each for its role alone. The administrator's overview: `internal/domain/dashboard`, route in
`cmd/api/dashboard-routes.go`. It owns no table and writes nothing; it reads orders,
order lines, employees, catalogue items, item sets and users in one read-only
`REPEATABLE READ` transaction, so its figures agree with each other.

| Route | Access |
| --- | --- |
| `GET /api/v1/dashboard` | admin |
| `GET /api/v1/dashboard/manager` | manager (not admin: the administrator has their own) |

In the web app each is its role's start screen: the Dashboard (`/dashboard`) for
administrators, the Manager Dashboard (`/manager`) for managers, Create Order for everyone
else; `/` and either dashboard's address show the signed-in user's own. A user who is both
administrator and manager starts on the Dashboard and opens the Manager Dashboard from it.

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
