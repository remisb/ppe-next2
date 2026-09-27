# Testing

How the Developer Logic Manual's rules are tested. Commands are in `CLAUDE.md`; CI runs all
three layers (`.github/workflows/ci.yml`).

| Layer | Where | Needs |
| --- | --- | --- |
| Go unit | `internal/**/service_test.go`, `*_test.go` with fakes | nothing |
| Go + Postgres | `internal/**/postgres_test.go`, `cmd/api/api_postgres_test.go` | `API_TEST_DB_DSN` (skipped otherwise) |
| Web unit | `web/**/src/**/*.test.ts` (Vitest) | nothing |
| End-to-end | `web/e2e/tests/order-lifecycle.spec.ts` (Playwright) | a migrated `*_test` database; starts its own API (:18090) and Vite (:5181) |

Go Postgres tests and the e2e suite each empty the test database: never run them at the same
time, and never point them at dev data (e2e refuses a database whose name does not end in
`_test`).

## Manual §7 — validation and failure behaviour

| Condition | Required response | Covered by |
| --- | --- | --- |
| Required size missing | Keep all work, highlight the line, show its dropdown | `size.TestResolve`; `order.TestResolveMissingSizesKeepLines`; web `validate` tests; server `CheckSize` (`TestMarkAsOrderedRejections` "missing size"); e2e *apply the set*, *missing size* |
| Catalogue price missing | Block Mark as Ordered, direct to Item Catalogue | `order.TestMarkAsOrderedRejections` "price missing"; `TestPostgresMarkAsOrderedRollsBack`; `TestPostgresMarkAsOrderedHTTP` (409); web `validate`; e2e *missing catalogue price* |
| Quantity < 1 or not an integer | Reject at field and server | `order.TestMarkAsOrderedValidate`, `TestResolveErrors`; HTTP 0, -1, 1.5, "2" → 400 (`TestPostgresMarkAsOrderedHTTP`, `TestPostgresCreateOrderResolution`); DB CHECK (`TestPostgresStatusInvariants`); web `validate`; e2e *quantity below 1* |
| Network / server error | Preserve form state, offer Retry | web draft persistence tests; e2e *network error keeps the form*, *draft survives a reload* |
| Expired / revoked token | Explain a new link must be requested | `order.TestLinkExpiryAndReplacement`; `TestPostgresConfirmation` (replaced link); HTTP 410 (`TestPostgresConfirmationHTTP`); e2e unknown link |
| Second confirmation | Return the existing GIVEN record as a no-op | `order.TestElectronicConfirmation`, `TestPaperConfirmation`; concurrent race in `TestPostgresConfirmation`; HTTP repeat; e2e reload after confirm |
| Catalogue / employee data changed | History and receipts keep the snapshots | `order.TestMarkAsOrderedSnapshots`; `TestPostgresMarkAsOrdered` (price, name, employee edits); e2e *a later price change does not alter the stored record* |

## Status transitions

Only `ORDERED` and `GIVEN` exist; the only transition is ORDERED → GIVEN.

| Transition / attempt | Result | Covered by |
| --- | --- | --- |
| (working state) → ORDERED via Mark as Ordered | Order + snapshot lines + `order.ordered`, one transaction | `TestMarkAsOrderedSnapshots`, `TestPostgresMarkAsOrdered`, concurrent record numbers, e2e |
| rejected Mark as Ordered | Nothing stored | `TestPostgresMarkAsOrderedRollsBack` |
| ORDERED → GIVEN electronically | Evidence + hash, `order.given` without actor | `TestElectronicConfirmation`, `TestPostgresConfirmation`, e2e |
| ORDERED → GIVEN on paper | Method `PAPER`, actor as giver, open links revoked | `TestPaperConfirmation`, `TestPostgresPaperConfirmation`, e2e |
| GIVEN → GIVEN (again) | No-op, same record | as §7 "Second confirmation" |
| GIVEN → confirmation link | 409 | `TestElectronicConfirmation`, `TestPostgresStatusInvariants`, HTTP |
| any other status, GIVEN without evidence, re-giving, editing lines | Rejected by the database | `TestPostgresStatusInvariants` |

## Other manual rules

| Rule | Covered by |
| --- | --- |
| Action visibility by state (§6) | web `historyActions` test; e2e ORDERED / GIVEN actions |
| Size resolution (§4.4, algorithm A) | `size` and `order.TestResolve*`; e2e suggested M from 170 cm, shoes never inferred |
| Apply Item Set uses fresh data (§3.4) | `TestApplyItemSet`, `TestPostgresCreateOrderResolution`, e2e |
| Save as Employee Default | web `applySavedDefault`; e2e (the saved shoe size resolves on the next order) |
| Usage time (algorithm D) | `TestUsageMonths`, `TestListAddsUsageTimeForGivenOnly`, e2e "0.0 months" |
| History filters in the organisation timezone | `TestListParamsDatesUseOrganisationTimezone`, `TestPostgresHistory` |
| WhatsApp text (algorithm E): no prices, no status | web `whatsapp` tests |
| Receipt from snapshot only, bilingual, € prices, stable hash (§8) | `TestReceiptIsSnapshotOnlyAndHashStable`; e2e public page and View Record |
| Audit events commit with their change | `TestPostgresFailedWriteRecordsNoEvent`, catalogue price event, `order.ordered` / `order.given` counts; append-only trigger in `audit.TestAppendOnly` |
| Route access per role | `cmd/api.TestRoutePolicy` (every route must be listed) |
| Change own password (8–72 bytes, current one required) | `user.TestPasswords`; web `validatePasswordChange`; e2e *Account: change password* |
| Users screen (admin only): add, edit, deactivate, reset password; no self-deactivation or self-demotion | `user` service tests, `TestRoutePolicy`; web `users` tests; e2e *Users: an administrator adds, edits, deactivates and resets a user* |
| Employee page at `/employees/<id>`: items given (from order snapshots) with a link to each receipt, items ordered but not yet given | web `employee-items`, `router` tests; e2e *Employees: a row opens the employee at its own address, with the items given and their receipts* |
| Catalogue item page at `/catalogue/<id>`, opened by clicking its row: current values, status and why an incomplete item cannot be ordered, price history (from the audit events), the orders holding it at their snapshot prices, the item sets that hold it; managers edit and (de)activate it there | `catalogue.TestPriceHistory`, `TestPostgresCatalogue`, `TestPostgresHistoryHTTP` (item filter, price history), `TestRoutePolicy`; web `router`, api-client tests; e2e *Item Catalogue: a row opens the item at its own address*, *Item page: price history and the orders that hold the item*, *phone and tablet: …* |
| Administrator dashboard (admin only, the admin start screen): awaiting orders, monthly ordered and given value, confirmation method and median wait, top items, replacements due, setup gaps | `dashboard.TestOverview*`, `TestPostgresOverview`, `TestPostgresDashboardHTTP`, `TestRoutePolicy`; web `dashboard`, `router` tests; e2e *sign in*, *Dashboard: the figures follow the orders*, manager part of *Users: …* |
| Manager dashboard (managers only, the manager's start screen): on order, monthly ordered value, spend by item, replacement forecast at current prices, price changes, catalogue and item-set gaps, sizes to stock | `TestManagerDerivedFields`, `TestPostgresManager`, `TestPostgresDashboardHTTP`, `TestRoutePolicy`; web `router` tests; e2e *Dashboard: the figures follow the orders*, manager part of *Users: …* |
| Employee dashboard (employee role only, its start screen; the user's own orders): awaiting orders with their link state, orders by month, recently given, replacements due, missing sizes | `TestEmployeeDerivedFields`, `TestPostgresEmployee`, `TestPostgresDashboardHTTP`, `TestRoutePolicy`; web `router`, api-client tests; e2e *Dashboard: the figures follow the orders*, employee part of *Users: …* |
| Column sorting: History sorted by the API across pages (empty usage last, ties by newest activity); other lists sorted in place, returning to their natural order where they have one | `TestListParams*`, `TestPostgresHistory`, `TestPostgresHistoryHTTP`; web `sort` tests; e2e *columns sort: History on the server across pages, other lists in place* |
| Mark as Ordered is confirmed on a review of the lines, sizes and total first; afterwards the next step is offered (confirmation link, WhatsApp, print) | e2e *Mark as Ordered creates the ORDERED record after a review* (Back to order keeps the lines), *paper confirmation* |
| An item set is applied with one tap, once the employee is chosen | e2e *Create Order: add a new employee from Assigned to and apply the set* |
| Delete and Deactivate sit in a record's ⋯ menu and ask first; a menu action does not also open the row's record | e2e *Item Catalogue: items with and without a price* (dismissed Deactivate), *Employees: less frequent and destructive actions are under ⋯* |
| Employees missing a size Create Order will flag (no shoe size; no clothing size and no height) are marked and can be filtered | web `missing-sizes` tests |
| Phone navigation: four sections in the tab bar, the rest with the account and Sign out under More; History counts the orders waiting for confirmation | e2e *History shows it ORDERED* (the count), every step that opens a section at 375px (`openTab` goes through More), *phone and tablet: …* |
| Dashboards compare the current month so far with the same days of the previous month (the whole of it when it is shorter) | `dashboard.TestPreviousPeriod`, `TestOverviewWindowAndDerivedFields`, `TestPostgresOverview`, `TestPostgresManager`, `TestPostgresEmployee`; web `dashboard` tests |
| History: status tabs (Awaiting · Given · All) with counts within the other filters; days waiting for confirmation, in the organisation timezone; a row opens its order at `/history/<id>`, beside the list from `lg`, instead of it below; the order holds the items and the actions its state allows | web `history` (`waitingDays`), `router` tests; e2e *History shows it ORDERED*, *Open Employee Confirmation creates a link*, *History shows it GIVEN*, *paper confirmation*, *phone and tablet: …* (an order on a phone) |
| Add Item searches the active catalogue by every word of name or manufacturer/model | web `items` tests; e2e *missing catalogue price*, *network error keeps the form*, *paper confirmation* |
| Quantity stepper: one more / one fewer, typing still allowed and invalid input kept and flagged | e2e *a reorder link starts the order…*, *quantity below 1 or not an integer* |
| A dashboard's Reorder opens Create Order for the employee with the item at the quantity given last time; the address drops it so a reload does not repeat it; it joins an order in progress for the same employee and asks before replacing another's | `TestPostgresOverview` (replacement quantity); web `router` tests (prefill address); e2e *a reorder link starts the order…* |
| Dashboards lead with Needs you: waiting orders (Send link), replacements due (Reorder), setup gaps and missing sizes, the urgent first | web `dashboard` (`sortNeeds`) tests; e2e *sign in* (empty), *Dashboard: the figures follow the orders* (unpriced item), employee part of *Users: …* |
| The employee's confirmation page says what is asked and lists the items before the full record; the consent is pinned to the bottom of the screen | e2e *the employee confirms on the public page* |
| Hand-over mode: the employee confirms on the staff member's device; `IN_PERSON`, the actor as giver, open links revoked, idempotent, refused without the tick; the database accepts the method (migration `0009`) | `order.TestInPersonConfirmation`, `TestPostgresInPersonConfirmation`, `TestPostgresConfirmationHTTP` (400 without the tick); `TestRoutePolicy`; e2e *hand-over: the employee confirms on this device* |
| Catalogue pictograms: a fixed set, `other` by default, refused by the service and the database otherwise; a new item's picture follows its name until picked | `catalogue.TestIcon`, `TestPostgresCatalogue`; web `items` (`guessIcon`) tests; e2e *a later price change* (Shoes guessed for Safety shoes) |
| The Create Order draft survives a closed tab, per user on the device; Sign out clears it, an expired session keeps it | web `working-order` draft tests; e2e *the draft survives a reload*, *the draft survives a closed tab, for the same user only* |
| Replacement due per item (latest given line + service period, months added as Postgres does; an item on an ORDERED order is reordered): the employee page's Replacement column and Reorder, Create Order's Due suggestions | web `employee-items` (`replacementsDue`, `addMonths`) tests; e2e *Employees: a row opens the employee…* (Replaced, Due) |
| ⌘K palette (record numbers, screens, employees, items; New order for an employee) and keyboard shortcuts (/, N, G then a letter, J/K, ⌘Enter, ?) | e2e *⌘K finds an order by its record number*, *⌘K finds an employee and starts an order for them* |
| History's `record` filter: one order by its record number however it is typed; anything else refused | `order.TestParseRecordNumber`, `TestListParamsRejections`, `TestPostgresHistory`, `TestPostgresHistoryHTTP`; web `history` (`looksLikeRecord`) tests |
| A dashboard figure with a list behind it is one tappable tile with a chevron: Awaiting / On order open History on the Awaiting tab (`/history?status=ORDERED`), Replacements due opens the Replacements due screen (the manager's jumps to the forecast), Missing sizes opens Employees filtered (`/employees?missing=1`); Missing sizes names the one person and what they miss | web `router`, `dashboard` (`missingSizesText`) tests; e2e *Employees: the Missing sizes tile's address opens the list filtered*, manager part of *Users: …* (On order) |
| Replacements due screen (`/replacements`): every replacement due within 30 days by the dashboards' rule, up to 500, tabs All / Overdue / Due soon, Reorder per row; under the user's Dashboard tab | `dashboard.TestReplacementsScreen`, `TestPostgresOverview` (the screen's list), `TestRoutePolicy`; web `router` tests; e2e *Replacements due: the whole list at its own address*, *phone and tablet: …* |
