# Item Catalogue service

The only normal source of item name, details, size group, unit price and service period.
Package `internal/domain/catalogue`, routes in `cmd/api/catalogue-routes.go`, table from
migration `0004_catalogue_items`. Manual §3.3 and §4.3.

## Entity

| Field | Notes |
| --- | --- |
| `name` | Required; unique among live items, case-insensitive |
| `details` | Manufacturer / model, free text |
| `size_group` | `CLOTHING`, `SHOES` or `NONE` |
| `unit_price_cents` | Optional while the item is being set up; ≥ 0 |
| `currency` | Always `EUR`; response only |
| `service_period_months` | Optional while being set up; ≥ 1 |
| `active` | Required in request bodies. Inactive items disappear from Add Item but stay in order snapshots |
| `display_rank` | Add Item sort key (ascending, then name). Default 1000. Give Safety shoes, Work jacket, Work trousers, Protective gloves, Safety helmet ranks 1–5 to get the manual's default ordering |

An item missing a price or service period is valid in the catalogue but not *orderable*
(`Item.Orderable`): Mark as Ordered refuses it and directs an authorised user here.

## Routes

| Route | Access |
| --- | --- |
| `GET /api/v1/catalogue` | any authenticated (all live items, incl. inactive) |
| `GET /api/v1/catalogue/active` | any authenticated (Add Item selector) |
| `GET /api/v1/catalogue/{id}` | any authenticated |
| `GET /api/v1/catalogue/{id}/price-history` | any authenticated; the live item's `catalogue.created` and `catalogue.price_changed` events as `{at, event, by_name, unit_price_cents, service_period_months, before_cents, before_service_months}`, newest first (404 for an unknown or deleted item) |
| `POST /api/v1/catalogue` | admin, manager |
| `PUT /api/v1/catalogue/{id}` | admin, manager (full replace) |
| `POST /api/v1/catalogue/{id}/activate`, `/deactivate` | admin, manager |
| `DELETE /api/v1/catalogue/{id}` | admin, manager (soft) |

## Audit

`catalogue.created` (after = price snapshot), `catalogue.price_changed` (before/after
`unit_price_cents`, `currency`, `service_period_months`), `catalogue.activated`,
`catalogue.deactivated`, `catalogue.deleted`. When one update changes both price and active
flag, the price event is recorded.
