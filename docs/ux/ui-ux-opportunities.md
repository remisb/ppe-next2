# UI and UX opportunities

Research into what the two web apps, **Workwear & Equipment** and **Administration**, can improve
next, and into what can become shared views, components and patterns. The yardstick is
[ui-ux-guidelines.md](ui-ux-guidelines.md), which the Item Catalogue's item pane already follows.
Every finding was checked in the code; paths are under `web/`, with `ww` for
`apps/workwear/src` and `ad` for `apps/admin/src`.

24 Oct 2026 · build `9e08b5c` · code review only (no usability sessions) · 48 findings in
four parts: defects, staff app, Administration and extraction.

## Summary

- **Four defects, each a small change.** The Audit log cannot filter Company Assets. "All N
  waiting" opens Orders on the wrong tab. The time after Mark as Ordered is in the browser's
  time zone. Orders forgets its filters after View Order and Print Order.
- **Administration has none of the new patterns yet.** `ad` imports no `IssueBadge`,
  `InfoTip`, `HelpPopover`, `DisclosureSection` or `RuleList`. Its figures lead nowhere, its
  badges do not explain themselves, and its hints are paragraphs.
- **The staff app's other panes lag the item pane.** In the order pane the actions sit under
  the lines and the facts run together on one line. The employee page is boxed. Hints are
  paragraphs that phones hide.
- **The biggest saving is a shared list-and-detail view.** Five screens copy the same layout,
  keyboard handling, close bar and hint. After it: filter tabs (copied 9 times), the
  loading/error ladder (about 25), action errors (8, plus 13 confirms) and a link style (about
  20, with 12 links that have no focus ring).

Effort: **S** under a day, **M** a few days, **L** a week or more.

---

## 1. Defects: fix first

**Fixed** in the change after this report: D1–D4 (D4 by remembering the list on the way to an order's record and restoring it once on the way back).

| # | Where | Problem | Fix | Effort |
|---|---|---|---|---|
| D1 | `ad/routes/audit.tsx:27-36` | `areaEvents` has no `assets` key, so the Area filter cannot narrow to Company Assets, although `AUDIT_AREAS` has it and asset records link | Add `assets: ['asset.']`. Better, build the map from `AUDIT_AREAS` so a new area cannot be missed | S |
| D2 | `ww/routes/dashboard.tsx:77`, `employee-dashboard.tsx:61` | "All N waiting" opens Orders on All. The route takes `status: 'ORDERED'`, as the Manager Dashboard's tile does | Pass `status: 'ORDERED'` | S |
| D3 | `ww/routes/create-order.tsx:786` | The result card prints `toLocaleString()` in the browser's time zone, not the organisation's (`API_ORG_TIMEZONE`) | Use `formatDateTime(…, tz)`, as everywhere else | S |
| D4 | `ww/app.tsx:500-504`, `routes/history.tsx:89-93` | View Order and Print Order go to the `record` route, which unmounts Orders. Its filters, page and sort are component state, so Back resets them | Print in place (`usePrintInPlace`, as the asset pane does), and keep the filters in the address | M |

## 2. Staff app

### Apply the guidelines where they are not followed yet

| # | Screen | Finding | Improvement | Effort |
|---|---|---|---|---|
| S1 | Order pane | Actions (Create confirmation link, Hand over now, Mark as Signed & Given) sit **below** the lines table (`components/order-detail.tsx:84-98`), so on a phone a long order pushes them off screen. Ordered, Prepared by, Given and Method run together on one muted line (`:143-148`) | Put the main action and ⋯ in the header row as the item and asset panes do, and add the facts grid between rules | M |
| S2 | Every list screen and dashboard | Hints are paragraphs under headings (`Panel`'s `description`, `PageHeader` descriptions). Phones hide several (`components/dashboard.tsx:111`, `employees.tsx:90`, `item-sets.tsx:52`, `create-order.tsx:302`, `replacements.tsx:51`) | Give `Panel` and `PageHeader` a `description` that draws an ⓘ, as `DisclosureSection` does. One change in `@ppe/ui` covers both apps | M |
| S3 | Asset pane | A boxed `bg-muted` note (`asset-detail.tsx:230-234`) repeats what the Not Activated badge already says | Remove it | S |
| S4 | Asset pane, employee page | **Not Returned** is a plain red badge (`asset-detail.tsx:212,407`, `held-assets.tsx:139`) | An `IssueBadge` that says what to do: Prepare Blocking Email, register the return | S |
| S5 | Order status (5 places) | The badge is written inline in five places. **Given** uses `default` though `success` means done, the pane adds a second "Signed" badge (`order-detail.tsx:132`), and a long wait is red text (`:127`) | One `OrderStatusBadge`, with a long wait as an `IssueBadge` that says what to do. *Decide:* Given as `success` | S–M |
| S6 | Employee page | Sizes and language are a `rounded-lg border` card with `p-4` boxes inside (`employee.tsx:163,222`). Due for replacement is a boxed `Alert` (`:279`). Given SIM and Equipment are cards (`held-assets.tsx:118`) | Flat facts between rules, a ruled callout, `RuleList` rows | M |
| S7 | Item Sets | Inactive items show as a text suffix (`item-sets.tsx:85-90`). Unpriced lines are not flagged, and lines do not link to their items. Sets have no Changes (`AuditRecordKind` lacks them) | `InactiveItemBadge`, an Incomplete flag, item links, and Changes once the audit route allows item sets | M |
| S8 | Loading | Every screen shows the text "Loading". Orders keeps the previous page on screen with no busy cue while a page or filter loads (`history.tsx:273`) | Skeleton rows the shape of the list, and `aria-busy` with a dimmed list while reloading | S–M |
| S9 | SIM numbers | The label telling the phone number from the SIM No. shows only on hover (`asset-detail.tsx:484-497`) | Show the label, or put it in an ⓘ | S |

### Fewer steps for frequent work

| # | Screen | Finding | Improvement | Effort |
|---|---|---|---|---|
| S10 | Orders | No search by record number, although the API takes `record` ("WE-000004", "we4", "4"). Today only ⌘K finds a number read out on the phone | A record-number field in the filters | S |
| S11 | Confirmation link | No one sees whether a link was sent, opened or expired; it lives in pane state (`order-detail.tsx:178`). Making it again replaces the old one without a word (`confirmation-sheet.tsx:17`) | Show "Link sent · opened / not opened / expired" as a fact, and ask first before replacing. Needs a field in the API | M–L |
| S12 | Create Order result | No **Hand over now**, although the employee is often standing there. The link block is a box (`create-order.tsx:799`) | Offer Hand over now, and give the block rules, as the order pane does | S |
| S13 | Employee page | No Return from the employee page (`held-assets.tsx:118-147`). Off-boarding means opening each asset, and Delete employee refuses while any are held | A `ReturnButton` per held asset (the `return` sheet exists) | M |
| S14 | Replacements | Each row's Reorder starts its own order (`replacements.tsx:151-160`); the employee page already has Reorder all | Group by employee, with Reorder all per employee | S–M |
| S15 | Manager Dashboard | Readiness lists stop at 6 and are not links (`manager-dashboard.tsx:411-418`), and "Open Item Catalogue" is not filtered (`:340-345`) | Link each item to its pane, and open the catalogue on Incomplete | S |
| S16 | Give sheet | The card choice reads 20 cards (`asset-sheets.tsx:548`), never says more exist, and ignores its loading and error states (`:562-563`) | "N more: search to narrow", with loading and error shown | S |
| S17 | Employees | Rows open a full page, not a pane beside the list (`employees.tsx:173`). The search is lost on Back, and there is no J/K | Open beside the list like Orders and the catalogue (after X1) | L |
| S18 | SIM Cards | No bulk action. A batch confirmed by the provider is changed one card at a time | Multi-select with Change Status | M–L |

## 3. Administration

| # | Screen | Finding | Improvement | Effort |
|---|---|---|---|---|
| A1 | Overview, System, Usage | Figures are dead ends and do not say what they count (`overview.tsx:115-147`, `system.tsx:159-162`, `usage.tsx:66-74`). `Kpi` supports `onOpen` and `help`, and the staff dashboard uses both | Link each figure to its rows (Users, Signed-in devices, Sign-ins filtered by kind and day, Errors, Backups) and add `help` | S |
| A2 | Users | Deactivating someone or removing Administrator happens without asking (`users.tsx:233,315-329`), and after Save the sheet just closes | Ask first ("Jonas will no longer be able to sign in."), then a status line ("Saved. …") | S |
| A3 | Status badges | Inactive user (`users.tsx:138-145`; the words exist in `t.users.inactiveExplained`), "Not used for N days" (`security.tsx:557-565`), Not ready with loose text (`system.tsx:113`), Failed backup with the raw error under it (`backups.tsx:136-142`), the owner warning (`system.tsx:239`) | `IssueBadge` for each: what is wrong, then what to do and where | M |
| A4 | Access review | Cannot be acted on. "Only marked users" is a checkbox with no count (`security.tsx:503-506`), the administrator and no-sign-in flags never show, rows have no actions, and "Open Users" opens the whole list | Filter tabs with counts; Edit (the existing `UserForm`); under ⋯, the person's Sign-ins and Changes | M |
| A5 | Hints everywhere | Paragraphs under headings (`security.tsx:325,464,530`, `backups.tsx:30`, `usage.tsx:100`, `overview.tsx:64`, `audit.tsx:533`) and every `Panel` description | Covered by S2's ⓘ on `Panel`/`PageHeader` | M |
| A6 | Change pane, error pane, lists | Changed fields in a `rounded-lg border p-3` box (`packages/audit/src/changes.tsx:109`). Facts without rules. The stack trace in a bare `<details>` (`system.tsx:455-477`). Boxed lists on Overview, Usage, Settings and Backups | `RuleList`, facts between rules, the stack trace in a `DisclosureSection` | S–M |
| A7 | Users | Only a free-text search (`users.tsx:44-53`). No Active/Inactive or role filter. The Roles screen's "N users" is plain text (`roles.tsx:106`) | Filter tabs with counts, a `role` filter, and a link from each role's count | M |
| A8 | Roles | Editing a role hides who it reaches, although `user_count` is loaded (`roles.tsx:200-206`) | "This change reaches 4 users", and ask first before taking a permission away | S |
| A9 | Error pane | A dead end (`system.tsx:455-471`): the person is not a link, and the reference has no copy button | Link the person to Sign-ins and the Audit log, add copy, and give the kind filter tabs with counts | S–M |
| A10 | Sign-ins, Audit log | People's names are not links (`security.tsx:252-258`, `audit.tsx:285-287`) | A name filters the list by that person, as the record chip does | S |
| A11 | Usage | Most active, Missing sizes and Unpriced lead nowhere (`usage.tsx:198-207,316`) | Link to the Audit log by actor, `/employees?missing=1`, and the catalogue (through `staffHref`) | S |
| A12 | Audit log | The seals callout is a 3–4 line box at the top of every visit (`audit.tsx:482-547`) | One ruled status line: a seals `IssueBadge`, the date, Verify, and an ⓘ for the details | M |
| A13 | Signed-in devices | No filter by person and no "sign out everywhere" (`security.tsx:298-405`) | A person filter grouped by person; "Sign out all of ⟨name⟩'s devices" needs an API endpoint | M–L |

## 4. Reusable views, components and patterns

Ranked by duplication removed. All go into `@ppe/ui` (or `@ppe/i18n`) unless noted. Each
lists the behaviour that differs between today's copies and must be kept or chosen
deliberately.

| # | Extract | Replaces | API sketch | Keep or decide | Effort |
|---|---|---|---|---|---|
| X1 | **`ListDetail`, `DetailPane`, `PaneBar`, `useListKeys`** | The list-and-pane grid on 5 screens (`history`, `catalogue`, `assets`, `ad/audit`, `ad/system`); the Back/Close bar (6); the J/K + Escape handler and "keep the open row in view" (3 each); `wide()` (3); the J/K hint (3) | `<ListDetail open list pane paneWidth>`, `<DetailPane label hint>`, `<PaneBar backLabel closeLabel onClose>`, `useListKeys({ ids, selected, onOpen, onClose })` | Pane widths (26, 28, 30rem); Close position (staff vs admin); admin has no J/K | L |
| X2 | **`StatusTabs`** | The segmented filter tabs, the same class copied 9×, 12 groups, 5 with counts | `<StatusTabs label options={{value,label,count?,help?}[]} value onChange layout="fill\|fit\|scroll">` | Count style (pill on assets, plain elsewhere: pick one); catalogue hides empty tabs and scrolls on a phone | M |
| X3 | **`<Loaded>` + `useLoads`** | The error/loading/empty/content ladder (~25 in both apps); combining several loads into one error with one Retry (4) | `<Loaded value empty emptyState>{(data) => …}</Loaded>`, `useLoads(a, b)` | `!data` vs `loading && !data` (the second keeps data on screen while reloading: make it the default, with S8's busy cue) | S |
| X4 | **`useAction` + `ActionError`** | `actionError` state with try/catch (8), the "Action failed" banner (7), `window.confirm` before acting (13), `changeStatus` written twice | `const act = useAction(); act.run(fn, { confirm, mapError })` → `{ error, pending, clear }`; `<ActionError error>` | Some screens never clear the old error; roles shows an Alert; employee maps a conflict to "holds assets" | S |
| X5 | **`linkVariants` / `TextLink`** | The text-link class string (~20 copies), plus **12 links with no focus ring at all** (an accessibility fix) | `linkVariants({ underline: 'hover'\|'always', touch?, mono? })`, `<TextLink>` | `inlineLink` in `ww/components/dashboard.tsx` becomes this | S |
| X6 | **`FactGrid` / `Fact`** | Local `Fact` helpers in 4 places (catalogue-item, employee, asset-detail `Detail`, ad/system) and one inline | `<FactGrid label cols layout="stack\|row" ruled>`, `<Fact label numeric?>` | Fixes the asset pane's facts (guidelines §12) | S |
| X7 | **`FormSheetActions`** | Cancel + submit pairs in 11 sheets, and `footerButtons` | `<FormSheetActions form busy disabled onCancel submitLabel>` | Adds a busy guard to item sets, the item form and the sizes form, which **can be submitted twice today** | S |
| X8 | **`useCursorPages` + `OlderButton`** | "Show older" pages appended, 3 copies (audit, sign-ins, errors) | `useCursorPages(key, fetch, pick)` → `{ items, loadOlder, olderState, reload }` | — | S |
| X9 | **`BackButton`** | The ghost back button with `-ml-3` and an arrow (10) | `<BackButton onClick narrowOnly?>` | `mb-2` on some only | S |
| X10 | **`OrderStatusBadge`** (workwear) | The order status written inline in 5 places (S5) | `<OrderStatusBadge order>` | Given's variant (decide) | S |
| X11 | **`Kbd` + key hints** | 3 local `Kbd` and 6 inline `<kbd>` | `<Kbd size="inline\|chip">` | — | S |
| X12 | **`BarList`** into `charts` | 3 bar-list implementations (staff dashboards, Usage ×2) | `items`, `scale?: 'max' \| number` | Track and bar colours and scaling differ: pick one look | S |
| X13 | **`RecordHeader`** | Pane headers with title, `lg:pr-10` and an actions corner (5) | `<RecordHeader title icon? badges? actions? details?>` | Title size (`xl` vs `lg`); the asset pane's SIM-number title | M |
| X14 | **Formatting** (`@ppe/i18n`) | `(cents/100).toFixed(2)` for inputs (6), `Intl.NumberFormat(intlLocale())` (3), `deviceLabel` duplicating `@ppe/audit`'s `deviceText`, the fixed `en-IE` euro formatter (2) | `euroInput(cents)` beside `parseEuro`, `formatNumber`, one document-euro constant; delete `ww/lib/devices.ts` | Check that the device words match before deleting | S |

Checked and **not** worth extracting: sorting (`SortableHead`, `SortControl` and `sortRows`
are already shared), remembered open state (`useRememberedOpen` is shared, and
`useOpenKey` has no Administration use yet), and the catalogue's pending move order (a single
instance).

---

## 5. Suggested order

1. **Defects** D1–D4, all in one change (about a day).
2. **Quick wins in the guidelines' direction** (S each): S3, S4, S10, S12, S15, S16, A1, A2,
   A8, A10, A11, plus X5 (the links without a focus ring) and X7 (double submit). **Done.**
   S12's Hand over now follows `HAND_OVER_NOW`, which keeps hand-over mode switched off for
   now.
3. **Shared pieces, then use them**: X3, X4, X2, X6, X9, X11, X14. Then S2/A5 (the ⓘ on
   `Panel` and `PageHeader`), which moves every hint in both apps at once.
4. **Panes to the item pane's anatomy**: X13 and X10, then S1 (order pane), S5, S6
   (employee page), A3, A6 and A12 (Administration's badges and panes).
5. **The list-and-detail view** X1. Then S17 (Employees beside the list) and the admin panes
   on it.
6. **New capabilities that need the API or bigger flows**: S11 (link state), S13, S14, S18,
   A4, A7, A13.

### Decisions for you

- **Given as a `success` (green) badge** instead of the filled default (S5, X10). The
  guidelines say green means done. Today Given is black, and Signed is the green one.
- **Employees beside the list** (S17): the employee page becomes a pane on wide screens, like
  Orders and the catalogue.
- **Replacing a confirmation link** (S11): keep it silent, or ask first and show the old link's
  state.
- **One count style on filter tabs** (X2): the plain muted number most screens use, or the pill
  the registers use.

The Help guide will need updating as these land; that is done separately.
