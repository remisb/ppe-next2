# Item Catalogue service

The only normal source of item name, details, size group, prices and service period.
Package `internal/domain/catalogue`, routes in `cmd/api/catalogue-routes.go`, table from
migration `0004_catalogue_items` (prices from `0021_purchase_price`). Manual §3.3 and §4.3.

## Entity

| Field | Notes |
| --- | --- |
| `name` | Required; unique among live items, case-insensitive |
| `details` | Manufacturer / model, free text |
| `size_group` | `CLOTHING`, `SHOES` or `NONE` |
| `purchase_price_cents` | **Purchase price**: what the supplier charges. Always optional, never needed to order; ≥ 0. Snapshotted on order lines, shown on no order or record |
| `accounting_price_cents` | **Accounting price** (labelled **Price** in the app): what the organisation books; the price orders, records and dashboards show and total. Optional while the item is being set up; ≥ 0. Named `unit_price_cents` before migration `0021` |
| `currency` | Always `EUR`; response only |
| `service_period_months` | Optional while being set up; ≥ 1 |
| `active` | Required in request bodies. Inactive items disappear from Add Item but stay in order snapshots |
| `display_rank` | Add Item sort key (ascending, then name). Default 1000. Give Safety shoes, Work jacket, Work trousers, Protective gloves, Safety helmet ranks 1–5 to get the manual's default ordering |
| `icon` | The item's pictogram: `shoes`, `jacket`, `insulated_jacket`, `trousers`, `vest`, `gloves`, `helmet`, `welding_helmet`, `glasses`, `ear`, `mask` or `other` (default). Optional in request bodies, omitted is `other`; the database refuses any other value. Migration `0008` guessed it for existing items from their names. Live data only: order snapshots do not copy it |

An item missing an accounting price or service period is valid in the catalogue but not *orderable*
(`Item.Orderable`): Mark as Ordered refuses it and directs an authorised user here.

## Routes

| Route | Access |
| --- | --- |
| `GET /api/v1/catalogue` | any authenticated (all live items, incl. inactive) |
| `GET /api/v1/catalogue/active` | any authenticated (Add Item selector) |
| `GET /api/v1/catalogue/{id}` | any authenticated |
| `GET /api/v1/catalogue/{id}/price-history` | any authenticated; the live item's `catalogue.created` and `catalogue.price_changed` events as `{at, event, by_name, purchase_price_cents, accounting_price_cents, service_period_months, before_purchase_cents, before_accounting_cents, before_service_months}`, newest first (404 for an unknown or deleted item) |
| `POST /api/v1/catalogue` | admin, manager |
| `PUT /api/v1/catalogue/{id}` | admin, manager (full replace) |
| `POST /api/v1/catalogue/{id}/activate`, `/deactivate` | admin, manager |
| `DELETE /api/v1/catalogue/{id}` | admin, manager (soft) |

## Audit

`catalogue.created` (after = price snapshot), `catalogue.price_changed` (before/after
`purchase_price_cents`, `accounting_price_cents`, `currency`, `service_period_months`; a
change to any of them records it), `catalogue.activated`, `catalogue.deactivated`,
`catalogue.deleted`. When one update changes both a price and the active flag, the price
event is recorded.

Audit events are append-only, so events written before migration `0021` keep their old
shape: the accounting price under `unit_price_cents` and no purchase price. The price
history and the Manager Dashboard's price changes read the accounting price as
`coalesce(accounting_price_cents, unit_price_cents)`.
