# Item Catalogue service

The only normal source of item name, details, size group, prices and service period.
Package `internal/domain/catalogue`, routes in `cmd/api/catalogue-routes.go`, table from
migration `0004_catalogue_items` (prices from `0021_purchase_price`, pictures from
`0036_catalogue_pictures`). Manual §3.3 and §4.3.

## Pictures

A **picture** is the category an item belongs to: a pictogram the web app draws, and the
**size group** of every item that has it. Table `catalogue_pictures`, one row per pictogram.

| Field | Notes |
| --- | --- |
| `icon` | The key: `shoes`, `jacket`, `insulated_jacket`, `trousers`, `vest`, `gloves`, `helmet`, `welding_helmet`, `glasses`, `ear`, `mask` or `other`, in the order the item form offers them (`catalogue.Icons`). A fixed set: the app draws each one, so pictures are never added or deleted, only changed |
| `id` | A fixed UUID per picture, the audit events' entity id |
| `size_group` | `CLOTHING`, `SHOES` or `NONE`: the size group of every item with this picture. Migration `0036` set each from the items that had it (production's agreed), else shoes → Shoes; jacket, insulated jacket, trousers and vest → Clothing; the rest → No size |
| `item_count` | Live items with this picture, active or not; response only |

Changing a picture's size group changes it for every item with that picture at once: Add
Item, Create Order and Mark as Ordered read it from the picture from then on. Order lines
keep the size group they were ordered with (their snapshot), and an order being created
whose lines no longer match is refused at Mark as Ordered as for any size error, so the
user adds the item again. The items' own Changes do not show it; the picture's change is on
the Audit log.

## Entity

| Field | Notes |
| --- | --- |
| `name` | Required; unique among live items, case-insensitive |
| `details` | Manufacturer / model, free text |
| `size_group` | `CLOTHING`, `SHOES` or `NONE`: the item's **picture's** size group, never the item's own (it has none since migration `0036`). Response only: request bodies may not send it |
| `purchase_price_cents` | **Purchase price**: what the supplier charges. Always optional, never needed to order; ≥ 0. Snapshotted on order lines, shown on no order or record |
| `accounting_price_cents` | **Accounting price** (labelled **Price** in the app): what the organisation books; the price orders, records and dashboards show and total. Optional while the item is being set up; ≥ 0. Named `unit_price_cents` before migration `0021` |
| `currency` | Always `EUR`; response only |
| `service_period_months` | Optional while being set up; ≥ 1 |
| `active` | Required in request bodies. Inactive items disappear from Add Item but stay in order snapshots |
| `display_rank` | Add Item sort key (ascending, then name). Default 1000. Give Safety shoes, Work jacket, Work trousers, Protective gloves, Safety helmet ranks 1–5 to get the manual's default ordering |
| `icon` | The item's picture (see Pictures), which sets its size group. Optional in request bodies, omitted is `other`; the database refuses any other value (a foreign key to `catalogue_pictures`). Migration `0008` guessed it for existing items from their names; the item form guesses a new item's from its name (`guessIcon`) until someone picks one. Live data only: order snapshots copy the size group, not the picture |
| `created_at`, `updated_at`, `created_by_user_id`, `updated_by_user_id`, `deleted_at`, `deleted_by_user_id` | Set by the service; response only |

An item missing an accounting price or service period is valid in the catalogue but not *orderable*
(`Item.Orderable`): Mark as Ordered refuses it and directs an authorised user here.

## Routes

| Route | Access |
| --- | --- |
| `GET /api/v1/catalogue` | any authenticated (all live items, incl. inactive) |
| `GET /api/v1/catalogue/active` | any authenticated (Add Item selector) |
| `GET /api/v1/catalogue/{id}` | any authenticated |
| `GET /api/v1/catalogue/{id}/price-history` | any authenticated; the live item's `catalogue.created` and `catalogue.price_changed` events as `{at, event, by_name, purchase_price_cents, accounting_price_cents, service_period_months, before_purchase_cents, before_accounting_cents, before_service_months}`, newest first (404 for an unknown or deleted item) |
| `POST /api/v1/catalogue` | `catalogue.manage`; a price or purchase price also needs `item_prices.manage` (403) |
| `PUT /api/v1/catalogue/{id}` | `catalogue.manage` (full replace); changing either price also needs `item_prices.manage` (403) |
| `POST /api/v1/catalogue/{id}/activate`, `/deactivate` | `catalogue.manage` |
| `DELETE /api/v1/catalogue/{id}` | `catalogue.manage` (soft) |
| `POST /api/v1/catalogue/{id}/move` | `catalogue.manage`; body `{"before_id": …}`: puts the item in front of that live item in the display order, or last when it is null or left out; answers every live item in the new order. 404 for an unknown item, 400 for an unknown `before_id` or the item itself |
| `GET /api/v1/catalogue/pictures` | any authenticated; every picture in `catalogue.Icons` order |
| `PUT /api/v1/catalogue/pictures/{icon}` | `catalogue.manage`; body `{"size_group": …}`; 404 for an unknown picture |

`catalogue.manage` is held by the built-in Administrator and Manager roles, and so is
`item_prices.manage` (**Change Item prices**, migration 0038, which needs `catalogue.manage`).
The handler passes `catalogue.Rights{Prices}` from it; without it `Create` refuses an item
with a price or purchase price and `Update` refuses changing either
(`catalogue.ErrNotPermitted`, under the row lock), so someone who only manages the catalogue
adds items without prices and edits them with their prices as they are. The service period
is not a price. In the app, Add Item and Edit Item show the two price fields disabled, with
a hint naming the permission.

**Move** changes as few display ranks as it can, under a lock on every live item: only the
moved item's, to one strictly between its new neighbours' (10 below the next when it goes
first, 10 above the last when it goes last), when they leave room; else every item is
numbered again 10, 20, 30… in the new order. Each changed rank records `catalogue.updated`
(`display_rank` before/after). Moving an item to where it is records nothing. The Item
Catalogue's move handle calls it (drag, or the arrow keys), only while no column is sorted.

## Audit

`catalogue.created` (after = price snapshot), `catalogue.price_changed` (before/after
`purchase_price_cents`, `accounting_price_cents`, `currency`, `service_period_months`; a
change to any of them records it), `catalogue.activated`, `catalogue.deactivated`,
`catalogue.updated` (the changed `name`, `details`, `icon` or `display_rank`,
before/after; a picture change also records the `size_group` it brought), `catalogue.deleted`.
One update records an event for each kind of change it makes, in that order: prices,
activation, details. They read on the Audit log and the item's Changes
([audit-service.md](audit-service.md)).

`catalogue.picture_changed` (entity `catalogue_picture`, the picture's `id`): before/after
`size_group`, and `icon` in both, naming the picture. Saving the size group it already has
records nothing. Events before migration `0036` recorded an item's own `size_group` in
`catalogue.updated`.

Audit events are append-only, so events written before migration `0021` keep their old
shape: the accounting price under `unit_price_cents` and no purchase price. The price
history and the Manager Dashboard's price changes read the accounting price as
`coalesce(accounting_price_cents, unit_price_cents)`.
