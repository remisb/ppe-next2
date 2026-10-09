# ADR 0004: Company Assets as a context of individual items, with a register-first UI

- **Status:** accepted
- **Date:** 2026-10-09
- **Scope:** backend (Go API, Postgres), frontend (`web/apps/workwear`), files
- **Builds on:** [ADR 0001](0001-modular-monolith-with-bounded-contexts.md),
  [ADR 0002](0002-permissions-and-administration-app.md)

## Context

The assets brief (`../PPE-documents/GAVORT_SIM_ir_inventoriaus_apskaitos_uzduotis.pdf`,
v1.0, 2026-10-08) adds SIM cards and individual equipment and furniture to the staff app.
The company must see what it owns, where each item is, who holds it and its whole history.

The app has nothing to build this on directly:

- Workwear tracks catalogue items by quantity on orders. An item on a Given order counts
  as given forever. There are no units, inventory or serial numbers, returns, locations or
  office stock.
- The brief keeps three facts apart (§2): a SIM card's connection status, where it is, and
  who holds it. A blocked card is not returned, and a departing employee keeps their items.
- There is no file upload or storage. The brief wants a scan of each signed form (§9).
- Some of it is reusable: employees (the brief forbids a second list), permissions, the
  audited `Mutation` repositories, immutable snapshots with a document hash, A4 printing,
  the Form sheet, `Table stack`, summary tiles, ⌘K Search and Changes.

The UI options were compared in the
[Company Assets UX review](../../ux/company-assets-ux-review.md).

## Decision

1. **A new context, Company Assets, in this API and database**, beside Workwear. ADR 0001's
   reasons hold, and none of its extraction triggers apply. The package is
   `internal/domain/asset` in today's flat layout, and it moves with the others if ADR 0001
   is accepted. It depends on People (the employee being assigned, a foreign key into the
   shared kernel) and, for signed copies, on the Files platform. Workwear and Company Assets
   do not read each other. The employee page puts both side by side in the web app.
2. **An asset is one physical item**, a row in `assets` of kind SIM or EQUIPMENT. It is not a
   catalogue item with a quantity, and it never appears on an order. Both kinds share one
   table and one engine; only SIM cards have a connection status.
3. **Who holds an asset is a row per assignment** (`asset_assignments`), with at most one
   open per asset by a partial unique index. Giving inserts a row, returning closes it, and
   nothing overwrites one. The database itself refuses a double give, as it refuses a second
   confirmation of an order.
4. **Location, office stock and Days Held are derived** from assignments, never stored. The
   connection status is changed only by Change Status. Each fact therefore has exactly one
   way to change.
5. **The assignment form is a snapshot with a document hash**, built like the Items Given
   Record: versioned templates, data copied at giving and never updated. The client prints a
   server-built preview and sends its hash back with Give. A form changed after printing is
   refused, so the paper and the stored form cannot differ.
6. **Signed copies are the first use of the Files platform** that ADR 0001 planned (object
   storage, streamed through the API). Slice 5 builds only what they need. Where files live
   and how they are backed up are decided before that slice.
7. **The UI is register-first, with three entry points** (option R of the UX review):
   - The Company Assets register: SIM Cards and Equipment & Furniture tabs, summary tiles
     that filter, and rows that offer the action their state allows. Each action is a Form
     sheet over the list.
   - An asset's page for its assignments, forms, signed copies and Changes. It is also where
     a phone user works.
   - Give buttons and the employee's assets on the employee page, and asset numbers in ⌘K
     Search.
   - On phones the section sits under More, with a Company Assets card on the dashboards.
   - After an action, the app offers the next one (for example Prepare Blocking Email after
     Mark as Not Returned).
   - No action asks for confirmation in a separate window (§2).
8. **One permission, `assets.manage`**, for every write. Reads need sign-in, as for
   employees and orders.

## Options considered

| | Extend Workwear (catalogue item + quantity) | **New context of individual assets (chosen)** | Separate service |
| --- | --- | --- | --- |
| One holder per item | Not expressible: lines have quantities | A unique index on open assignments | Same, but behind an API |
| Return, location, stock | New concepts bolted onto orders, which never change | Native | Native |
| Transactions with employees and audit | One | One | Distributed |
| Cost | Rewrites order rules the manual fixes | New tables and screens | New tables and screens, plus a service |

The UI options were: A, register and action sheets; B, an item-page hub; C, employee-first
with ⌘K actions; D, an inline grid; and R, which combines A, B and C. R takes the fewest
steps over nine key actions (43 on desktop, against 45–49 for the others). It keeps every
gate in §6 and reuses the app's own patterns. D ties on taps but cannot hold the print and
signature gates in a cell, and it fails on phones.

## Consequences

- New tables `assets`, `asset_assignments`, `asset_numbers` and `asset_number_counters`;
  new events in `audit.Events()`; a new entity type for Changes; the permission in
  `permission.go` and `permissions.ts`; routes in the policy table.
- `GET /api/v1/assets` is the second paged search list allowed query parameters by the
  domain-service contract.
- The Main nav gets a section, the ⌘K palette a new kind of result, and the employee page
  two sections. Help and its screenshots follow when the user asks for them.
- The open questions in the spec are business decisions (employment status, file storage,
  company details, providers, form templates, write-off, existing assignments at go-live).
  Until each is decided, the build uses the default the spec states.
- Slices: 1 terms and spec (this ADR); 2 data and domain; 3 SIM register; 4 give, return,
  not returned and the form; 5 signed copies; 6 employee page and search; 7 Equipment &
  Furniture; 8 go-live tools once decided.
