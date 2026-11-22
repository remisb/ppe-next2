# Supplier service

The companies catalogue items are bought from. Package `internal/domain/supplier`, routes in
`cmd/api/supplier-routes.go`, table `suppliers` and `catalogue_items.supplier_id` from
migration `0054_suppliers`. Administration's **Suppliers** screen manages them
(`web/apps/admin/src/routes/suppliers.tsx`, rules `src/lib/suppliers.ts`); the staff app's
Add Item and Edit Item choose an item's supplier, and its item page shows it.

An item has **at most one supplier, optionally**. The supplier's WhatsApp group in Settings
(`settings.SupplierChat`, Copy for WhatsApp) is a separate, older setting and is not tied to
these records.

## Entity

| Field | Notes |
| --- | --- |
| `code` | **Internal code**: required, at most 32 characters, unique among live suppliers case-insensitively (`suppliers_code_live_idx`), so a deleted supplier's code may be used again |
| `name` | The company's name: required, at most 200 characters. Not unique |
| `company_code` | The company's registration number (*įmonės kodas*); optional, at most 50 |
| `vat_code` | VAT payer's code; optional, at most 50; saved in upper case without spaces |
| `address` | Street and building; optional, at most 300 |
| `city` | Optional, at most 100 |
| `postal_code` | Optional, at most 20 |
| `country` | ISO 3166-1 alpha-2 (`LT`), or empty; saved in upper case. The database's CHECK refuses any other shape |
| `contact_person` | Optional, at most 200 |
| `email` | Optional; one bare address with a dot in its domain, at most 254 (`internal/email`, the rule users, suppliers and SIM providers share); saved in lower case |
| `phone` | Optional, at most 50, as typed |
| `website` | Optional, at most 300, as typed |
| `bank_account` | The IBAN; optional, at most 50; saved in upper case without spaces |
| `notes` | Free text; optional, at most 2000 |
| `item_count` | Live catalogue items naming the supplier; response only |
| `created_at`, `updated_at`, `created_by_user_id`, `updated_by_user_id`, `deleted_at`, `deleted_by_user_id` | Set by the service; response only |

Every text is trimmed. Limits count characters, not bytes, in the service, the database's
CHECKs and the form alike. Request bodies may send only the fields above
(`DisallowUnknownFields`): `id`, `item_count`, timestamps and actors are refused (400).

## An item's supplier

`catalogue_items.supplier_id` (foreign key `catalogue_items_supplier_fkey`, nullable). The
item's JSON carries `supplier_id` and `supplier_name`, both `null` for none; the request body
of Add Item and Edit Item takes `supplier_id` (`null` or left out for none, as Edit Item
replaces every field). Choosing it needs `catalogue.manage`, like the rest of the item, and
not `item_prices.manage`.

- A `supplier_id` naming no live supplier is refused (400): the catalogue service asks the
  suppliers through its consumer-declared `catalogue.Suppliers` (adapter `catalogueSuppliers`
  in `cmd/api/checkers.go`), and the foreign key refuses an unknown id regardless.
- **A deleted supplier unbinds** (the contract's cross-domain rule): the catalogue's reads join
  live suppliers only, so an item whose supplier is deleted reads as having none, and the
  next save of the item clears the stale id. Deleting a supplier never changes an item row.
- Order lines do not snapshot the supplier.

## Routes

| Route | Access |
| --- | --- |
| `GET /api/v1/suppliers` | any authenticated (Edit Item offers them): every live supplier by name, then code, each with `item_count` |
| `GET /api/v1/suppliers/{id}` | any authenticated; 404 for an unknown or deleted supplier (a single-object lookup) |
| `POST /api/v1/suppliers` | `suppliers.manage`; 201 with `Location`; 409 for a live supplier's code |
| `PUT /api/v1/suppliers/{id}` | `suppliers.manage`; full replace; 409 for another live supplier's code |
| `DELETE /api/v1/suppliers/{id}` | `suppliers.manage` (soft); 204; 404 the second time |

**Manage Suppliers** (`suppliers.manage`, group Administration, migration 0054) is the built-in
Administrator's; other roles get it on Roles & permissions. It opens Administration (it is in
`ADMINISTRATION_PERMISSIONS` and the launcher's `administration` list).

## Audit

Entity type `supplier`, area `catalogue`; the Audit log names a supplier by its current name,
marked deleted when it is.

| Event | Payload |
| --- | --- |
| `supplier.created` | after: every field but the notes |
| `supplier.updated` | the changed fields, before and after; changed notes are `notes_changed: true`, never their text. Saving what it has records nothing |
| `supplier.deleted` | before: `code` and `name` |

An item's supplier change is part of `catalogue.updated`: `supplier_id` (hidden by the apps)
and `supplier`, the supplier's name then, before and after (`null` for none).

## Screens

- **Administration → Suppliers** (`/admin/suppliers`, in More on a phone): the list with search
  (code, name, company and VAT code, city, contact, email), sortable by code, name, place and
  items; **Add Supplier** and **Edit** open a form sheet (Company, Address, Contact, Notes);
  ⋯ has **Changes** (the Audit log filtered to the supplier, for `audit.read`) and
  **Delete supplier…**, which asks first and says how many items will have no supplier.
- **Staff app → Item Catalogue**: Add Item and Edit Item have **Supplier** (No supplier, or one
  of the list as "Name (code)"); the item page's facts show it.
