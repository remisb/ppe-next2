# Testing

How the Developer Logic Manual's rules are tested. Commands are in `CLAUDE.md`; CI runs all
three layers (`.github/workflows/ci.yml`).

| Layer | Where | Needs |
| --- | --- | --- |
| Go unit | `internal/**/service_test.go`, `*_test.go` with fakes | nothing |
| Go + Postgres | `internal/**/postgres_test.go`, `cmd/api/api_postgres_test.go` | `API_TEST_DB_DSN` (skipped otherwise) |
| Web unit | `web/**/src/**/*.test.ts` (Vitest) | nothing |
| End-to-end | `web/e2e/tests/order-lifecycle.spec.ts` (Playwright) | a migrated `*_test` database; starts its own API (:18090) and Vite (:5174) |

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
