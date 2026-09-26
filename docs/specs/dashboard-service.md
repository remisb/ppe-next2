# Dashboard service

The administrator's overview: `internal/domain/dashboard`, route in
`cmd/api/dashboard-routes.go`. It owns no table and writes nothing; it reads orders,
order lines, employees, catalogue items, item sets and users in one read-only
`REPEATABLE READ` transaction, so its figures agree with each other.

| Route | Access |
| --- | --- |
| `GET /api/v1/dashboard` | admin |

In the web app it is the administrator's start screen (`/` and `/dashboard`); anyone else
gets Create Order at both addresses.

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
