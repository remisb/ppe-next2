# Workwear UX Review

UX research report for Workwear & Equipment (PPE-next2). It reviews all 15 screens at
phone (375 px), tablet (768–1366 px) and desktop (1280 px) widths. For each problem area there are two or three
design options, each with a sample screen, pros and cons, and a recommendation.

27 Sep 2026 · reviewed build `1ff7a0c` · demo data · roles: admin, manager, employee ·
status: phases 1–3 shipped, plus follow-ups (`121644f`)

> **Status, updated 28 Sep 2026.** Phases 1–3 are built and live at the production site:
> every recommendation in the table below is done. Phase 1 shipped in `3c76945`, phase 2
> in `aee8829` and phase 3 in `a663ce0`; record-number search and tappable dashboard
> figures followed in `13214e8`, the Replacements due screen in `65da1ad`, the
> employee confirmation page as option A in section 7 in `c0cf0bc`, Create Order as option A
> in section 3 in `acfc5b6`, a one-page Print Record in `1dcc4ed`, the raised New order
> button in `c089c1a`, compact History rows in `7edcdcc`, Show password in `312676a`, the
> shorter confirmation wording in `49a1ce3`, compact phone dashboards in `b9cda4d`, and the
> records lists as option A in section 6 in `9213136`, and History option C in section 4 in
> `f8e3982`, its order pane tightened in `121644f`.
> Each came with its e2e steps (33 in total, all passing). The findings, figures and "today" samples in this report describe the app as
> reviewed, build `1ff7a0c`, before these changes. The [roadmap](#10-roadmap-phases-13-shipped)
> lists what shipped in each phase, where it differs from the proposal, and what is still
> open.

> The sample screens are drawn in [`workwear-ux-review.html`](workwear-ux-review.html).
> Open it in a browser to see them. This Markdown version keeps the full text, and gives
> rough text sketches of the recommended screens.

## Contents

0. [Summary](#0-summary)
1. [Method](#1-method)
2. [Navigation](#2-navigation)
3. [Create Order](#3-create-order)
4. [History](#4-history)
5. [Dashboards](#5-dashboards)
6. [Records lists](#6-records-lists)
7. [Employee confirmation](#7-employee-confirmation)
8. [Tablet](#8-tablet)
9. [Desktop power layer](#9-desktop-power-layer)
10. [Roadmap: phases 1–3 shipped](#10-roadmap-phases-13-shipped)
11. [References](#11-references)

---

## 0. Summary

**A solid base that needs a denser phone layout and a safer order step.**

The app gets the hard parts right. It has one navigation that changes shape for each
screen size, tables that turn into cards on a phone, 44 px touch targets, safe-area
padding, a sticky primary bar, careful empty and error states, and a receipt that prints
on A4. The problems are mostly about **density and priority**. On a phone, each record
becomes a tall card with its own row of full-width buttons, so people scroll a lot and
every card competes for attention. The most important step, **Mark as Ordered**, cannot be
undone, yet it runs on a single tap with no review.

| Measure | Finding |
|---|---|
| **7** | tabs in the admin's phone bar. Apple and Material both recommend 3–5, and two of the labels are cut off |
| **248 px** | height of one Create Order line on a phone. A 5-item set makes a 1,949 px page |
| **2.4** | History orders visible per phone screen (cards are 254–282 px tall) |
| **28%** | of the phone screen on Create Order used by fixed bars (57 + 105 + 65 px) |
| **0** | review steps before an order becomes immutable |
| **704 px** | of content on a 1024 px landscape iPad, so every table still shows as phone cards |

### Top recommendations

| # | Change | Screen | Platform | Impact | Effort | Status |
|---|---|---|---|---|---|---|
| 1 | Add a review sheet before Mark as Ordered, and show the next steps after it (confirmation link, WhatsApp, print) | Create Order | Both | High | S | Done (Phase 1) |
| 2 | Phone bar with four tabs plus More. Move Catalogue, Item Sets, Users and Account into More | App shell | Phone | High | S | Done (Phase 1) |
| 3 | Compact order lines: size chip and a −/+ quantity stepper on one 64 px row, with price details on tap | Create Order | Phone | High | M | Done (Phase 2) |
| 4 | Apply an item set with one tap on a chip (today it takes a select plus Apply). Add items from a search field | Create Order | Both | High | S | Done (Phases 1–2) |
| 5 | History status tabs (Awaiting · Given · All) with counts, a "days waiting" chip, and 64 px rows that open the record | History | Phone | High | M | Done (Phase 2) |
| 6 | Replace the Actions column with a list and a detail pane beside it | History | Desktop | Med | M | Done (Phase 2; option C in full, `f8e3982`) |
| 7 | Put what needs attention first on the dashboard: 2×2 figures, then a "Needs you" list where each item has one action | Dashboards | Both | Med | M | Done (Phases 1–2) |
| 8 | List rows open the record's page. Move Delete and Deactivate out of every card into a ⋯ menu. Flag missing sizes in the list | Employees, Catalogue | Both | Med | S | Done (Phase 1; option A in full, `9213136`) |
| 9 | Confirmation page: put a summary first and keep the consent bar pinned to the bottom of the screen | Employee confirmation | Phone | High | S | Done (Phase 2; option A in full, `c0cf0bc`) |
| 10 | A ⌘K command palette and keyboard shortcuts in Create Order | All | Desktop | Med | M | Done (Phase 3) |
| 11 | Keep the icon rail until 1280 px, so a landscape iPad gets 888 px of content and real tables | App shell | Tablet | High | S | Done (Phase 1) |
| 12 | One-column rows in portrait, list and detail in landscape, chosen by container width | Lists, History | Tablet | Med | M | Done (Phase 2) |

---

## 1. Method

- **Walkthrough.** Every route was opened as an administrator against the local demo data,
  at 375×812, 1280×800 and four tablet sizes (768×1024, 1024×768, 1180×820 and
  1366×1024). Create Order was run end to end: pick an employee, apply
  "Warehouse starter kit", then review.
- **Measurement.** Row and card heights, page heights and the height of the fixed bars were
  measured in the DOM, so the density findings are numbers rather than impressions.
- **Heuristics.** Nielsen's 10 usability heuristics, Apple HIG tab bars, the Material 3
  navigation bar, and WCAG 2.2 target size (2.5.8 minimum 24 px, 2.5.5 enhanced 44 px).
- **Patterns.** List-detail, progressive disclosure, a review step before irreversible
  commits, thumb-zone placement, and command palettes (as in Linear, GitHub and Slack).
- **Code reading.** The public `/confirm` page, the success panel after Mark as Ordered and
  the dashboard figures were checked in the source, because the demo data could not reach
  every state.

The sample screens are sketches in the app's own visual language (Geist, shadcn
neutrals), so they read as proposals for this product rather than a restyle. Names,
prices and sizes are the demo data.

---

## 2. Navigation

**Fewer tabs, full labels, less fixed chrome.**

### Findings

- **High. Seven tabs for an admin on a 375 px phone.** Each tab is 53 px wide and the
  labels cut off ("Employ…", "Catalog…"). Apple and Material both cap a bottom bar at five
  destinations.
- **Med. Setup screens take tabs that daily work needs.** Item Catalogue, Item Sets and
  Users change rarely, yet they take the same space as Create Order and History.
- **Med. The brand bar repeats on every screen** (57 px), and each page title then appears
  again below it. Together with the tab bar, 15% of every phone screen is fixed chrome.
- **Good.** One `<nav>` that becomes a tab bar, a rail or a sidebar; hidden full labels
  for screen readers; safe-area padding; and the pill marking the active tab.
- **Fixed, live since `3c76945` and `c089c1a`.** Phase 1 built option A: the phone bar holds four sections and More, with full labels and a count on History. `c089c1a` added option B on top of it: Create Order is the raised New order button in the middle of the bar. The brand bar still repeats above each phone page.

### Options

#### Baseline: seven tabs (current)

*Sample: today's admin phone bar with seven tabs; "Employ…" and "Catalog…" are cut off.*

| Pros | Cons |
|---|---|
| Every section is one tap away | Truncated labels hurt scanning and recognition |
| Same tabs on every screen | Tabs are 53 px wide, so mis-taps are easy with gloves on |
| | No room for badges such as "3 awaiting" |

#### A. Four tabs plus More (recommended)

Keep the four daily destinations. Setup screens, the account and Sign out go into a More
sheet, which can show warnings such as "1 incomplete". The page title replaces the brand
bar.

```
┌──────────────────────────────────────┐
│ History                              │
│                                      │
│ ┌ More ────────────────────────────┐ │
│ │ Item Catalogue      1 incomplete │ │
│ │ Item Sets                      › │ │
│ │ Users                          › │ │
│ │ Administrator                  › │ │
│ │ Sign out                         │ │
│ └──────────────────────────────────┘ │
├──────────────────────────────────────┤
│ Home  Order  History³ Employees More │
└──────────────────────────────────────┘
```

| Pros | Cons |
|---|---|
| Full labels and 75 px targets, which meets HIG and Material | Catalogue and Sets take one extra tap |
| Space for a badge on History ("3 awaiting") | More can turn into a junk drawer if it grows |
| Account moves off the top bar, so the bar can hold the page title | Needs updates to the e2e nav steps and the AGENTS.md nav rule |
| Works for all three roles without change | |

#### B. Raised "New order" button (alternative, built in `c089c1a`)

The main job, preparing an order, gets a raised button in the centre of the bar, where
the thumb rests. If a draft exists, the button reopens it and shows a line count.

| Pros | Cons |
|---|---|
| The primary task is visible and reachable from every screen | Can feel like a consumer app |
| Common in field-service and logistics apps | An icon-only button needs a visible label or tooltip |
| | Draft handling (resume or start new) makes the behaviour ambiguous |

**As built:** Built in `c089c1a`, on top of option A rather than instead of it: the phone bar reads Home · History · New order · Employees · More, with Create Order as a raised button in the middle. It always carries a visible label, answering the icon-only con: "New order", or "Draft" with the line count while an unsent order is saved, which the button reopens. The bar reorders with CSS, so the rail and sidebar keep one order and are unchanged.

#### Desktop sidebar

*Sample: a sidebar with the sections "Daily work" (Dashboard, Create Order with a
"5 lines" draft chip, History with a count of 3), "Records" (Employees 1, Item Catalogue 1,
Item Sets) and "Admin" (Users), plus a "Search or jump to… ⌘K" field at the top.*

| Pros | Cons |
|---|---|
| Group labels match how often each area is used | Counts need a light summary endpoint, or reuse of the dashboard figures |
| Counts turn the sidebar into a to-do signal (awaiting, missing sizes, incomplete items) | Red counts can become noise; show them only for things that block work |
| The draft chip reminds users about an unsent order | |

---

## 3. Create Order

**Compact lines and a review before commit.**

### Findings

- **High. Mark as Ordered commits in one tap.** The order becomes an immutable snapshot at
  once. "New order" asks before clearing a draft, but the irreversible action does not ask
  first.
- **High. Each line is a 248 px card.** Unit price, service period and total take more
  space than the controls people actually change (size and quantity). A 5-line set is 2.4
  screens long.
- **Med. Applying an item set takes two actions**: choose from a select, then press Apply
  Item Set. Add Item is a native select with no search or grouping, which works for 9 items
  but not for 60.
- **Med. Quantity is a text field.** Changing 1 to 2 opens the keyboard and hides half the
  screen.
- **Med. The employee's saved sizes are not shown** after picking them, so users cannot see
  why a line says "39" or "S (160–167 cm)". On a phone the size select also cuts off its
  label.
- **Med. After ordering there is no clear next step.** The success panel offers WhatsApp and
  "Start a new order". Sending the confirmation link, the step that closes the loop, means
  going to History.
- **Good.** Sizes resolved from the employee's defaults, the saved draft, validation shown
  as "5 lines · complete", and a sticky total that is always visible.
- **Fixed, live since `acfc5b6`.** Phases 1 and 2 added the review before Mark as Ordered, the success screen with next steps, one-tap set chips, compact rows with steppers and a searchable Add item. `acfc5b6` completed option A: the saved sizes show under Assigned to, sets already on the order are marked, the review can create the confirmation link as well, and on a laptop or desktop a summary panel sits beside the lines.

### Options

#### A. Compact composer with a review sheet (recommended, built in `3c76945`, `aee8829`, `acfc5b6`)

Keep the single page that experienced users like, but make every part smaller. The
employee card shows the saved sizes. Item sets are one-tap chips. Each line is a 64 px
row with a size chip and a stepper. The sticky bar becomes one "Review" button that opens
a sheet holding the irreversible step.

```
┌──────────────────────────────────────────┐
│ New order                          Clear │
│ (OK) Ona Kazlauskienė  W-002      Change │
│      165 cm · Clothing S · Shoes 39      │
│ ! Gloves overdue since 30 Aug    [+ Add] │
│ [✓ Starter kit]  [+ Visitor PPE]         │
│ [ Add an item…                        ]  │
│ Safety shoes      €54.90  [39 ▾] [− 1 +] │
│ Work jacket       €79.00  [S ▾]  [− 1 +] │
│ Work trousers     €45.50  [S ▾]  [− 2 +] │
│ Protective gloves  €3.20  [ — ] [− 10 +] │
│ Safety helmet     €18.00  [ — ]  [− 1 +] │
│ [ Review · 5 lines              €274.90 ]│
├──────────────────────────────────────────┤
│ Home   Order   History   Employees  More │
└──────────────────────────────────────────┘

Review sheet:
┌──────────────────────────────────────────┐
│ Review order     for Ona Kazlauskienė    │
│ Safety shoes · 39             1 × €54.90 │
│ Work jacket · S               1 × €79.00 │
│ Work trousers · S             2 × €45.50 │
│ Protective gloves             10 × €3.20 │
│ Safety helmet                 1 × €18.00 │
│ Total                            €274.90 │
│ [✓] Create the confirmation link as well │
│ After this the record cannot be changed. │
│ [ WhatsApp ]        [ Mark as Ordered ]  │
└──────────────────────────────────────────┘
```

| Pros | Cons |
|---|---|
| A 5-line order fits on one screen instead of 2.4 | Line totals move to the review sheet |
| The irreversible action gets a summary and a clear warning | A stepper is slow for 10+; tapping the number must still allow typing |
| Showing sizes explains how lines were resolved | Needs new Stepper, Sheet and Combobox components |
| A "due now" hint reuses the dashboard's replacement data to suggest lines | Changes most Create Order e2e selectors |
| The same model works on desktop (see below) | |

**As built:** Phases 1 and 2 built the review sheet, the success screen, the one-tap set chips, the compact rows with steppers and size chips, and the searchable Add item; `acfc5b6` completed the option. The employee's saved sizes show under Assigned to ("189 cm · Clothing 2XL (60–62) · Shoes 46"), with a missing size in red. A set already on the order carries a ✓, and applying it again asks first. The bar is one Review button with the line count and total. The review sheet holds Copy for WhatsApp and "Create the confirmation link as well", on unless the device turned it off; the success screen then shows the link ready to send. ↑ / ↓ step a quantity. Line totals stayed on the rows rather than moving to the review sheet.

#### B. Three-step wizard: Who → What → Review (alternative)

Each step is one short decision. The tab bar is hidden while the task is open, which gives
a focused, modal task.

*Sample: step 2 of 3 with a progress bar, "For Ona Kazlauskienė · S · 39", item set cards
with "Use" buttons, a search field and "Add" rows, and a "Next: review" button.*

| Pros | Cons |
|---|---|
| Easy for occasional users and the employee role | Slower for experts who repeat the same set daily |
| The review step is part of the flow | Changing the employee after step 2 means going back and re-resolving sizes |
| Every step fits one screen, with no scrolling and no fixed chrome | Browser Back must be mapped to steps, or the draft feels lost |

#### C. Shop grid with a cart (later, if the catalogue grows)

An e-commerce layout: pictures, category filters and a floating cart. The picture is what
people recognise in a warehouse, so this pays off once the catalogue has dozens of items.

*Sample: a 2-column grid of item tiles with pictograms (boot, jacket, glove, helmet,
glasses, vest), filter chips All / Clothing / Shoes / No size, and a floating "2 items ·
€64.90 · Review" cart bar.*

| Pros | Cons |
|---|---|
| Familiar from every shopping app, so it needs no training | Needs item images or pictograms (a new catalogue field) |
| Recognition beats recall: people spot the boot rather than reading "S3 SRC" | Slower than applying a set, which is the common case |
| Scales to a large catalogue with filters | Size and quantity are edited in the cart, which splits attention |

#### Desktop A: lines beside a sticky summary panel (built in `acfc5b6`)

*Sample: the lines table (item, size chip, stepper, unit, service, total) with an
"Add an item… /" search field and set chips above it. On the right, a summary panel:
employee with sizes, a "Gloves overdue since 30 Aug · already in this order ✓" note,
"Last order WE-000002 · 30 Jul", "5 lines · complete", the total €274.90, and the buttons
"Review and mark as ordered" and "Copy for WhatsApp". Keyboard hints: `/` add item,
`⌘↵` review.*

| Pros | Cons |
|---|---|
| Who, what and how much are all visible at once, with no bottom bar | Needs about 1100 px of content width; below that the panel drops under the table |
| The summary panel has room for context: sizes, last order, what's due | A second place to keep in sync with the phone's sticky bar |
| Keyboard use: `/` focuses Add, `↑↓` changes quantity, `⌘↵` opens the review | |

**As built:** From 60 rem of content (a laptop with the sidebar, or wider), the bar becomes a sticky panel beside the lines, built in `acfc5b6`: who the order is for and their last order (linked to History), what they are due with a ✓ once it is on the order, the lines and total, Review and mark as ordered, Copy for WhatsApp, and the keys `/`, `⌘/Ctrl ↵` and `↑↓`. The saved sizes stay under Assigned to rather than moving into the panel. Beside the panel the lines are the compact one-line rows rather than a full table, which needs 48 rem.

> **Recommendation.** Build **A** on both platforms. Ship the review sheet and the "next
> steps" success screen first, since they are small and protect an irreversible action.
> Keep **C** in reserve for when the catalogue passes about 30 items.

---

## 4. History

**Filter by status, act in context.**

### Findings

- **High. Too many buttons on desktop.** Each row stacks 2–3 buttons (View Items, then
  Open Employee Confirmation or View Record plus Print Record). The black primary button
  repeats on every ORDERED row, so nothing stands out and rows double in height.
- **High. Phone cards are 254–282 px tall**, and the first one starts 303 px down, below
  the intro text, the time-zone note and the sort control. About 2.4 orders fit on a
  screen.
- **Med. The most useful fact is missing.** For ORDERED rows the usage column shows "—",
  when the question people have is "how long has this been waiting?" (the dashboard
  already has "12 days").
- **Med. Status is hidden in a filter select**, but "Awaiting vs Given" is the main way
  people split this list.
- **Fixed, live since `aee8829` and `7edcdcc`.** Phase 2 added the status tabs with counts, the aging chips and the order page (beside the list on desktop). `7edcdcc` made the phone list dense: two-line rows of about 70 px instead of 254–282 px, a heading per month, and the first order at 222 px instead of 303 px. `f8e3982` completed option C: beside an open order the desktop list is one line a row again, 38 px at 1280 and 1440 px, where it had been the phone's two-line rows of about 70 px.

### Options

#### A. Status tabs, compact rows, order page (recommended on phone, built in `aee8829`, `7edcdcc`)

Tabs answer the main question. Rows show who, what and how long, and one tap opens a
single order page where all actions live. Sort and date filters go into the filter sheet.

```
┌──────────────────────────────────┐      ┌──────────────────────────────────┐
│ History                     🔍 ⏷ │      │ ← WE-000004        Waiting 12 d  │
│ [Awaiting 3] Given 3   All       │      │ Aleksandr Ivanov                 │
│ September                        │      │ W-006 · ordered 15 Sep 09:30     │
│ Jonas Petraitis             3 d ›│      │ Safety shoes · 46     1 × €54.90 │
│  WE-000006 · 24 Sep · €32.00     │      │ Work jacket · 2XL     1 × €79.00 │
│ Tomas Jankauskas            4 d ›│      │ Work trousers · 2XL   2 × €45.50 │
│  WE-000005 · 23 Sep · €34.40     │      │ Total                    €224.90 │
│ Aleksandr Ivanov           12 d ›│      │ Confirmation                     │
│  WE-000004 · 15 Sep · €224.90    │      │ [ Send confirmation link ]       │
│                                  │      │ [ Print record ] [ Paper signed… ]│
└──────────────────────────────────┘      └──────────────────────────────────┘
```

| Pros | Cons |
|---|---|
| About 7 orders per screen instead of 2.4 | Actions are one tap deeper |
| A red aging chip draws the eye to the overdue order | Tabs replace the status filter, so the filter sheet and API parameters must match |
| One action model: list to navigate, page to act | A new order detail screen for ORDERED records (today only GIVEN records have one) |
| A single order URL can be shared or bookmarked (the record route exists already) | |

**As built:** Phase 2 built the tabs, aging chips and the order page; `7edcdcc` completed the rows. Where the table stacks, the orders are one bordered list of two-line rows: the employee and an aging pill (red after 14 days) or Given, then record · date · value, with a chevron. Sorted by date, a heading row per month groups them, on desktop too. On a phone the description is hidden and the sort order and time-zone note fold into Filters. The tabs still open on All, as phase 2 decided; Awaiting is one tap away.

#### B. Slimmer cards: one action plus ⋯ (low-effort step)

Keep `<Table stack>` and its cards. Each card shows the next action for its status (Send
link, or View record) with a secondary style, and the rest goes into ⋯.

| Pros | Cons |
|---|---|
| A small change that stays inside the existing Table stack rule | Still roughly half the density of A |
| Actions stay one tap away | A ⋯ menu hides actions such as Print from new users |
| Cards drop to about 120 px, so about 4 fit per screen | |

#### C. List and detail (recommended on desktop ≥ 1200 px, built in `aee8829`, `f8e3982`, `121644f`)

*Sample: tabs Awaiting · 3 / Given · 3 / All · 6 above a one-line table (Record,
Employee, Ordered, Waiting chip, Value). The selected row WE-000004 opens a right-hand
pane with its lines, the total, "Send confirmation link", "Print", "Paper signed…" and a
`J`/`K` hint.*

| Pros | Cons |
|---|---|
| Rows go back to one line (about 36 px); the only primary button is in the pane | Needs width; between 768 and 1200 px it falls back to the order page from A |
| Chase several waiting orders without leaving the list (J/K) | The selected row must be kept in the URL so Back and refresh work |
| Items are visible without "View Items" expanding rows | |

**As built:** Phase 2 built the pane beside the list from 1024 px, kept at `/history/<id>` so Back and refresh work, with the items, the total and the actions, and J / K; `f8e3982` completed the option. Beside the pane the list keeps Record, Employee, Date, Status and Total value: Usage time and the time of day drop out, and a waiting order shows its wait as a pill (red after 14 days) in place of the Ordered badge. The table stacks only under 30 rem of room (a new `stackBelow="sm"`), so it stays one line a row, 38 px, from about 1200 px; at 1024 px, beside the rail, it falls back to the two-line rows, as the con expects, rather than to the order page. Escape closes the pane, J / K keep the open row in view, and the pane ends with a “J / K next or previous order · Esc close” hint where there is a keyboard. The status tabs sit above the list as in the sample; Send confirmation link is Open Employee Confirmation, and Paper signed is in its sheet. J / K stop at the end of a page of 20 orders. In `121644f` the pane's Close ✕ moved into its top-right corner: it had a row of its own, so the order began about 76 px down the pane, and now starts 17 px from its top, beside the ✕. A phone keeps Back to History on its own row.

---

## 5. Dashboards

**What needs doing, before the charts.**

### Findings

- **Med. The admin dashboard is 2,712 px on a phone (3.3 screens).** Four full-width
  figure tiles take 470 px, 58% of the first screen, before anything a user can act on.
- **Med. Lists you can't act on.** "Replacements due" and "Longest waiting" name exactly
  the next job, but offer no button to do it.
- **Med. Misleading comparison.** "Given in Sep €0.00 · −100% vs Aug" compares the month
  so far with all of August. Early in a month every figure looks like a collapse.
- **Good.** Honest figures, the time zone stated, an accessible data table behind the
  chart, and the Setup panel that points to what blocks ordering.
- **Fixed, live since `aee8829` and `b9cda4d`.** Phase 2 put Needs you ahead of the charts, with one action per item (Send link, Reorder, Add sizes, Fix); phase 1 compares with the same days of the previous month. `b9cda4d` fitted it to a phone: the figures take 184 px instead of 248 px and Needs you starts at 341 px instead of 449 px, with five actions on the first screen. The page is 2,223 px, down from 2,712 px.

### Options

#### A. Attention first (recommended, built in `aee8829`, `b9cda4d`)

A 2×2 figure grid (about 150 px), then one "Needs you" list that merges waiting orders,
due replacements and setup gaps. Each item has one verb. Charts follow below.

```
┌──────────────────────────────────────────┐
│ Good morning                           ⟳ │
│ ┌ Awaiting ──────────┐ ┌ Replacements ─┐ │
│ │ 3   oldest 12 days │ │ 1   1 overdue │ │
│ ├ Ordered in Sep ────┤ ├ Given in Sep ─┤ │
│ │ €291  +71% vs      │ │ €0  3 orders  │ │
│ │       1–27 Aug     │ │     pending   │ │
│ └────────────────────┘ └───────────────┘ │
│ Needs you · 4                            │
│ [12 d] Aleksandr Ivanov      [Send link] │
│ [Due ] Ona K. · gloves         [Reorder] │
│ [Size] Rasa Stankevičiūtė          [Add] │
│ [Item] Winter jacket               [Fix] │
│ Spending by month …                      │
└──────────────────────────────────────────┘
```

| Pros | Cons |
|---|---|
| The first screen answers "what should I do now?" | Reorder needs a prefill route (`/orders/new?employee=…&item=…`) |
| Actions link straight into existing flows (Reorder opens Create Order prefilled) | The merged list needs a clear sort rule (by severity, then age) |
| Month comparison uses the same days of the previous month | Analytics move lower, which may bother finance-minded admins |
| The same layout serves the manager and employee dashboards with different items | |

**As built:** Phase 2 built the layout: the figures, then one Needs you list merging waiting orders, due replacements and setup gaps, sorted by severity then age, with Reorder opening Create Order prefilled. `b9cda4d` completed the phone view. Each figure tile shows one fact beside the figure, such as “3 · oldest 13 days” or “€274.90 · +62% vs 1–28 Aug”; the full detail stays for screen readers and shows from tablet width. The header's description folds away, Refresh is an icon, and Needs you counts its items (“Needs you · 6”). The heading stays “Dashboard” rather than a greeting, and the manager and employee dashboards share the same parts with their own facts.

#### B. Today / Trends / Setup tabs (alternative)

The same content split into three short views. Today is the default.

| Pros | Cons |
|---|---|
| Every view is short on a phone | Content behind tabs gets seen less often |
| Admins who want analytics get a clean Trends view | On desktop the tabs waste the space that fits everything at once |

---

## 6. Records lists

**Employees, Catalogue, Item Sets, Users: rows that open pages, and no Delete on every card.**

### Findings

- **High. Destructive buttons sit next to everyday ones.** Every Employee card has Delete
  at the same weight as Edit, and every Catalogue card has Deactivate. This makes
  accidental taps likely (Nielsen #5, error prevention).
- **Med. Cards grow with the list.** Employee cards are 171 px and Catalogue cards 230 px.
  At 100 employees the list is about 17,000 px long.
- **Med. The list doesn't flag blocking gaps.** The dashboard counts "1 missing a size",
  but in the list it shows only as a faint "–". "Incomplete" is flagged in the Catalogue,
  which is the right model.
- **Med. There is no "New order for this person"** on the employee page, which is where
  the intent to order often starts.
- **Fixed, live since `3c76945` and `9213136`.** Phase 1 moved Delete and Deactivate into ⋯ and flagged missing sizes; `9213136` completed option A. On a phone an employee is a 66 px two-line row instead of a 171 px card, and a catalogue item 67 px instead of 230 px: 100 employees now take about 6,900 px, not 17,000 px. A missing size is a red chip beside the name, and the employee page has New order.

### Options

#### A. Row list and record page (recommended, built in `3c76945`, `9213136`)

Lists are for finding a record, and pages are for acting on it. The Employees and
Catalogue item pages already exist; this makes them the only place with edit and delete
actions, and adds "New order" and a due-date bar per item.

```
┌──────────────────────────────────┐      ┌──────────────────────────────────┐
│ Employees                 [+ Add]│      │ ← Ona Kazlauskienė             ⋯ │
│ 🔍 Search by name or code         │      │ Height 165 cm  Clothing S  Shoes 39
│ [All 6] [⚠ Missing size 1]       │      │ [+ New order]  [Edit sizes]      │
│ (AI) Aleksandr Ivanov          › │      │ Items and when they're due       │
│      W-006 · 189 cm · 2XL · 46   │      │ Protective gloves ×10   Overdue  │
│ (JP) Jonas Petraitis           › │      │  Given 30 Jul · 1 month ████████ │
│      W-001 · 184 cm · XL · 43    │      │ Safety shoes · 39       Jul 2027 │
│ (RS) Rasa Stankevičiūtė  No shoe │      │  Given 30 Jul · 12 months █░░░░░ │
│      W-004 · 171 cm · M          │      │ Delete employee is in ⋯, with a  │
│ (TJ) Tomas Jankauskas No clothing│      │ confirmation.                    │
│      W-003 · 190 cm · 45         │      │                                  │
└──────────────────────────────────┘      └──────────────────────────────────┘
```

| Pros | Cons |
|---|---|
| 3.7× denser on a phone; the whole demo team fits on one screen | Edit Sizes, a frequent quick fix, becomes two taps (a row swipe or long-press can add a shortcut) |
| Delete moves behind ⋯ and a confirmation, so it can't be hit by accident | Rows are hand-built rather than the generic `<Table stack>`; the AGENTS.md rule needs a "list" variant |
| Missing sizes show up where they get fixed | |
| The same pattern applies to Catalogue (price on the right, "Incomplete" chip) and Users | |

**As built:** `9213136` completed the option. Employees, Item Catalogue and Users stack as one bordered list of short rows, a `stack="list"` mode of the same `<Table>` that History now shares, rather than hand-built rows: the AGENTS.md rule gained that list variant. An employee row shows initials, the name with "No shoe size", "No clothing size" or "No sizes" beside it, then code · height · clothing · shoes; All and Missing a size chips filter it. On a phone a row has no buttons and opens its page; the employee page holds New order, Edit Sizes and ⋯ with Edit details and Delete employee…, which asks first. The due-date bars were already on that page. Rows measure 66 px, so the gain is 2.6× rather than the 3.7× estimated, and 6 rows fit below the search, chips and sort on the first screen. Edit Sizes on a phone is two taps, as the con says; no swipe shortcut was added.

#### Catalogue: grouped rows with status chips (applies A, built in `9213136`)

Status filter chips (Active 9 · Incomplete 1 · Inactive 1) replace the Status column.
Grouping by size group (Clothing, Shoes, No size) mirrors how sizes are resolved.
Deactivate moves to the item page.

| Pros | Cons |
|---|---|
| The one blocking item stands out | Grouping and a manual "display order" sort can conflict; pick one as the default |
| Prices line up on the right for quick comparison | |

**As built:** Built in `9213136`. The chips are All · Active · Incomplete · Inactive, each item in one of them (an inactive item counts as Inactive even without a price), and on a phone they scroll sideways in one row. The Status column stays on desktop. Display order stays the default, because it is the order Add Item lists; sorting by Size group adds a heading per group, as History does per month. A phone row shows the picture, name and price, then details · size group · service period, with Incomplete or Inactive under them. Edit and Deactivate are on the item page, and in the table under ⋯.

**Desktop:** keep the tables, but move row actions into a ⋯ menu that appears on hover
and focus. Keep one quiet inline action per row ("Edit sizes" for Employees). Item Sets
cards gain a total ("5 items · €274.90") and a "Use in new order" link. On Users, "Reset
password" moves into ⋯ as well.

**As built:** Built in `9213136`, except that ⋯ stays visible on every row rather than appearing on hover, since touch screens have no hover. Employees keep Edit Sizes inline, the Catalogue Edit. Item Sets show "5 items · €274.90 at today's prices" (an item with no price is left out, and the card says so) and Use in new order, which opens Create Order with the set's items: before an employee is chosen they wait unresolved, as Add Item's do, and join the order in progress otherwise. Users moved Reset password into ⋯ and lost the two-up cards on a phone.

---

## 7. Employee confirmation

**Public page on the employee's own phone: say the task first, keep the consent in reach.**

### Findings

- **High. The consent sits below a long bilingual A4 document.** The person opening the
  link from WhatsApp is not an app user. They have to scroll the whole record before they
  learn what they are being asked to do.
- **Good.** No sign-in, a whole-label tap target on the checkbox, a disabled button until
  consent, bilingual copy, an explicit expired-link state, and a confirmation that can be
  repeated safely.
- **Fixed, live since `c0cf0bc`.** The first screen now says what is asked, lists the items
  and quotes the statement agreed to; the full record is one tap away and the consent sits
  at the bottom of the screen (option A below). Hand-over mode on the counter tablet shows
  the same screen.

### Options

#### A. Summary first, consent pinned to the bottom (recommended, built in `c0cf0bc`)

The first screen says in plain words what is asked, lists the items, and pins the consent
to the bottom. The full bilingual document is one tap away and unchanged. The EN/RU
switch changes only the interface; the legal document stays bilingual.

```
┌──────────────────────────────────┐      ┌──────────────────────────────────┐
│ ⛑                      [EN] RU   │      │                                  │
│ Ona, please confirm you received │      │               ✓                  │
│ 4 items                          │      │        Receipt confirmed         │
│ Order WE-000002 · from           │      │ Thank you, Ona. WE-000002 is     │
│ Administrator · 30 Jul 2026      │      │ recorded as given on 1 Aug 2026  │
│ Safety shoes · 39             ×1 │      │ at 14:02. You can close this     │
│ Work jacket · S               ×1 │      │ page.                            │
│ Work trousers · S             ×2 │      │          [ View record ]         │
│ Protective gloves            ×10 │      │                                  │
│ What you confirm                 │      │                                  │
│ "I confirm receipt of the listed │      │                                  │
│ items in the stated sizes …"     │      │                                  │
│ [ View full record (EN / RU) ]   │      │                                  │
├──────────────────────────────────┤      │                                  │
│ [ ] I have received the items    │      │                                  │
│     listed and agree with the    │      │                                  │
│     confirmation text.           │      │                                  │
│ [ Confirm receipt ] (disabled)   │      │                                  │
└──────────────────────────────────┘      └──────────────────────────────────┘
```

| Pros | Cons |
|---|---|
| Someone opening the link cold understands the task in about 3 seconds | Legal review: is consent valid if the full text is collapsed? A fallback is to require opening it once, or to show it inline below the items |
| The consent is always within thumb reach | The language switch adds a small piece of state |
| The document hash and the legal text are unchanged | |

**As built:** the public page and hand-over mode now follow this option. The first screen asks “Ona, please confirm you received 5 items”, gives the order, who prepared it and the date, lists the items, and quotes the confirmation statement from the locked record in the chosen language. View full record (EN / RU) opens the unchanged bilingual record in place. The consent sits at the bottom of the screen even when the order is short. EN / RU changes only the interface wording: the public page starts in the browser's language and remembers the choice on that phone, while hand-over starts fresh for each employee. After confirming, the page says when the receipt was recorded, and View record opens it. Quoting the statement next to the items answers most of the legal question, because the consent refers to text on the screen. Whether the collapsed record is enough still needs legal sign-off.
The confirmation statement was shortened in `49a1ce3` to “I confirm receipt of the listed items in the stated sizes and quantities, in good condition for work. I know each item’s service period.” (Russian: “Подтверждаю получение перечисленных предметов указанных размеров и количества, в надлежащем состоянии для работы. Знаю срок службы каждого предмета.”). The wording is part of the hashed record, so each order keeps the version it was placed under: the 11 orders placed before stay on `2026-09-v1`, and new orders get `2026-09-v2`.

#### B. Slide to confirm (not recommended)

A swipe gesture instead of checkbox plus button.

| Pros | Cons |
|---|---|
| Hard to trigger by accident | Fails WCAG 2.5.1 (pointer gestures) without a single-tap alternative |
| Feels modern | Weaker as explicit consent than a labelled checkbox |

#### C. Finger signature (consider with legal)

Draw a signature on the screen, like a courier delivery.

| Pros | Cons |
|---|---|
| Mirrors the paper process people already know | Biometric-like data to store and protect under GDPR |
| The signature image can go on the printed record | Hard for motor-impaired users; needs an alternative |
| | Changes the receipt and its document hash |

---

## 8. Tablet

**Tablet, 768–1366 px: use the width the iPad actually has.**

A tablet is likely to sit on the stores counter where workwear is handed out, or travel
with a manager around the site. It is a touch device with a desktop-class width, it
rotates, and on iPad it can share the screen with another app. The app handles most of
this well, because tables decide whether to become cards from their own width, not the
device's. The weak spot is where the sidebar starts.

| Device | Viewport | Navigation | Content width | How tables show |
|---|---|---|---|---|
| iPad, portrait | 768 × 1024 | Icon rail, 88 px | 632 px | Cards everywhere: two per row for Employees, Catalogue and Create Order, one per row for History |
| iPad, landscape | 1024 × 768 | Labelled sidebar, 240 px | **704 px** | **Cards everywhere**, with Create Order lines 248 px tall and History cards 194 px |
| iPad Air, landscape | 1180 × 820 | Labelled sidebar | 860 px | Tables for Employees and Create Order; cards for History and Catalogue |
| iPad Pro 12.9″, landscape | 1366 × 1024 | Labelled sidebar | 1046 px | Tables everywhere |

### Findings

- **High. Landscape iPads get a phone layout next to a desktop sidebar.** The labelled
  sidebar starts at 1024 px, which is exactly iPad landscape. It takes 240 px (23% of the
  width) and leaves 704 px, below the 768 px a table needs, so every screen falls back to
  cards.
- **Med. Two-up order cards squeeze the controls in portrait.** Each Create Order card is
  half-width, so the size select cuts off ("S (160–167 cn") and the quantity field is about
  70 px wide. A 5-line set becomes three rows of 248 px cards.
- **Med. History in portrait starts with filters.** Employee, From, To, Status and Sort
  take the top 398 px before the first order, and each card is full-width with two
  full-width buttons.
- **Med. Hover ideas don't carry over.** An iPad has no hover unless a trackpad is
  attached. Any desktop affordance that appears on hover (a ⋯ menu, a record preview) must
  stay visible on touch screens, using `@media (hover: none)`.
- **Good.** Container-query stacking means layouts follow the actual window, including iPad
  Split View and Slide Over, so the app never needs to detect the device. Buttons grow to
  44 px on touch screens, and the phone tab bar is gone from 768 px, which frees the bottom
  of the screen.

### App shell on a landscape tablet

#### Baseline: sidebar from 1024 px (current)

*Sample: at 1024 × 768 the labelled sidebar sits beside Create Order shown as two-up
cards; the Item Set select is squeezed to "Choo…" and the size select to "S (160–167 c".*

| Pros | Cons |
|---|---|
| Full section names are always visible | Content is 704 px, so every table shows as cards |
| Same sidebar as on a laptop | The Item Set select is squeezed to "Choo…" |
| | Only 4 of 5 order lines are visible above the action bar |

#### A. Keep the rail until 1280 px (recommended)

Move the labelled sidebar from `lg` (1024 px) to `xl` (1280 px). A landscape iPad keeps
the 88 px icon rail and gets 888 px of content instead of 704. Employees and Create Order
become tables again, and Create Order has room for the summary panel.

```
┌───────┬─────────────────────────────────────────────────────────────────┐
│ ⛑     │ Create Order                                             Clear  │
│ Home  │ [ Add an item…            ] [✓ Starter kit] [+ Visitor]         │
│ Order │ Item               Size  Qty       Total │ (OK) Ona K.          │
│ Hist³ │ Safety shoes       [39▾] [− 1 +]  €54.90 │ S · 39 · 165 cm      │
│ Empl. │ Work jacket        [S▾]  [− 1 +]  €79.00 │ Gloves overdue ·     │
│ Cat.  │ Work trousers      [S▾]  [− 2 +]  €91.00 │ in this order ✓      │
│ Sets  │ Protective gloves   —   [− 10 +]  €32.00 │ 5 lines · complete   │
│ Users │ Safety helmet       —    [− 1 +]  €18.00 │ Total  €274.90       │
│       │                                          │ [ Review ]           │
│       │                                          │ [ WhatsApp ]         │
└───────┴─────────────────────────────────────────────────────────────────┘
```

| Pros | Cons |
|---|---|
| 184 px more content width on the most common tablet width | Laptop users between 1024 and 1279 px lose the full names |
| A one-breakpoint change in `app.tsx` and the AGENTS.md rule | History and Catalogue need 960 px; they still need the list-and-detail layout or a column dropped to become tables |
| The rail still labels every icon, so nothing becomes a guessing game | The e2e "no sideways scrolling" check at 1100 px must be re-baselined |
| Laptops with narrow windows benefit too | |

#### B. Collapsible sidebar (alternative)

Keep the sidebar at 1024 px, add a collapse button, and remember the choice per device.

| Pros | Cons |
|---|---|
| People choose between labels and space | A default still has to be chosen, and most people never change defaults |
| A common pattern (Gmail, Notion, Linear) | One more control and one more stored preference |

#### C. Separate tablet layouts (not recommended)

Detect touch and orientation, and serve tablet-specific screens.

| Pros | Cons |
|---|---|
| Each device could be tuned exactly | Breaks in Split View, and when a keyboard or trackpad is attached |
| | Works against the container-query approach the app already uses |
| | Two layouts to test and keep in sync |

### Screens on a tablet

#### Portrait: one-column rows, not two-up cards (recommended)

At 632 px a list row has room for name, record, value and status on one line, so rows beat
half-width cards. This applies to History, Employees (sizes as small columns) and
Catalogue (price and service period on the right). Create Order uses the compact line rows
from section 3 at full width.

```
┌───────┬──────────────────────────────────────────────┐
│ ⛑     │ History                            [Filters] │
│ Home  │ [ Employee or record…                      ] │
│ Order │ [Awaiting · 3]    Given · 3     All · 6      │
│ Hist³ │ Jonas Petraitis          €32.00   3 days   › │
│ Empl. │  WE-000006 · ordered 24 Sep                  │
│ Cat.  │ Tomas Jankauskas         €34.40   4 days   › │
│ Sets  │  WE-000005 · ordered 23 Sep                  │
│ Users │ Aleksandr Ivanov        €224.90  12 days   › │
│       │  WE-000004 · ordered 15 Sep                  │
│       │                                              │
└───────┴──────────────────────────────────────────────┘
```

| Pros | Cons |
|---|---|
| About 12 orders on the first portrait screen instead of 3 | Two-up cards look fuller on a large empty screen |
| The first order starts about 200 px down instead of 398 | Active filters must show as chips, or people forget a filter is on |
| Size selects get full width, so labels are no longer cut off | |
| Reuses the phone's row list, so no new component | |

#### Landscape: list and detail (recommended)

The desktop list-and-detail layout from section 4 needs about 860 px of content, so with
the rail it fits a landscape iPad. Tap a row and its lines and actions open beside the
list. A container query, not a device check, decides when the pane appears.

*Sample: rail, status tabs, three waiting orders on the left with WE-000004 selected, and
a pane on the right with its lines, total €224.90, "Hand over now", "Send link", "Print"
and "Paper…".*

| Pros | Cons |
|---|---|
| Chase several waiting orders without leaving the list | The detail pane is narrow; long item names need to wrap |
| The same component as on desktop | The selected order must be kept in the URL across rotation |
| Rotating to portrait falls back to the order page, with no special code | |

### Idea: hand over at the counter

#### Hand-over mode on the storekeeper's tablet (needs a product decision)

At the counter the storekeeper taps "Hand over now" on a waiting order. The tablet
switches to a full-screen view with no navigation, built from the same content as the
public confirmation page, and is turned to the employee. The employee ticks and confirms;
the order becomes GIVEN on the spot. The storekeeper gets the tablet back with a long press
or by signing in again.

```
┌──────────────────────────────────────────────────────┐
│ [EN] RU                         Hand back · hold 2 s │
│ Ona, please check your items and confirm             │
│ you received them                                    │
│ Order WE-000002 · prepared by Administrator          │
│  Safety shoes · 39                                ×1 │
│  Work jacket · S                                  ×1 │
│  Work trousers · S                                ×2 │
│  Protective gloves                               ×10 │
│  Safety helmet                                    ×1 │
│ [ Read the full record ]                             │
├──────────────────────────────────────────────────────┤
│ [ ] I have received the items listed and             │
│     agree with the confirmation text.                │
│ [               Confirm receipt                  ]   │
└──────────────────────────────────────────────────────┘
```

| Pros | Cons |
|---|---|
| Closes the loop in seconds, with no WhatsApp link to chase and no paper to file | A third confirmation channel ("in person on a staff device") must be recorded on the receipt and in the audit trail, which is a change to the manual |
| Fits how gear is actually handed out: face to face, at a counter | The employee must not be able to leave the view; iPad Guided Access is advisable |
| Reuses the confirmation page, its consent text and the receipt | It proves the employee was present less strongly than a signature does; check this with whoever owns the legal wording |
| Large type and 44 px rows suit people in gloves or without their glasses | |

> **Recommendation.** Keep the rail until 1280 px first. It is a one-line change and fixes
> landscape iPads on every screen. Then use one-column rows in portrait and list-and-detail
> in landscape, both driven by container width. Take hand-over mode to the product owner:
> it fits counter work best, but it changes how confirmation is recorded.

---

## 9. Desktop power layer

**A power layer for people who use it all day.**

The desktop layout is a well-behaved responsive version of the phone. Office users who
prepare many orders a week benefit from features a phone does not need: keyboard
shortcuts, jump-to search and denser tables.

*Sample: a ⌘K palette over the dashboard. Typing "ona" offers: Actions (New order for Ona
Kazlauskienė ↵; Reorder gloves for Ona Kazlauskienė (overdue)), Employees (Ona Kazlauskienė
· W-002), Orders (WE-000002 · Given 30 Jul), and "Go to Item Catalogue (G C)".*

| Pros | Cons |
|---|---|
| The fastest route from intent to action: "ona", then Enter, gives a prefilled order | Only discoverable through the ⌘K hint in the sidebar and a "?" shortcut sheet |
| One search box across employees, orders and screens | Needs a search endpoint or client-side indexes (fine at this data size) |
| Nothing is taken away for mouse users | |

- **Keyboard shortcuts:** `/` focuses search or Add item; `N` starts a new order; `J`/`K`
  moves through lists; `⌘↵` opens the review; `?` shows all shortcuts.
- **Density:** a Comfortable/Compact switch for tables, saved per user. Compact rows are
  32 px, and targets stay 24 px or more (WCAG 2.5.8) on pointer devices.
- **Hover previews:** hovering a record number such as WE-000004 shows its lines and
  status, so users don't have to navigate away. On touch screens (`hover: none`) the ⋯
  menus stay visible and previews open on tap.
- **Relative dates:** show "3 days ago" in lists with the exact time in a tooltip.
  Receipts keep absolute dates.

---

## 10. Roadmap: phases 1–3 shipped

### Phase 1: quick wins (safety and orientation) — done, `3c76945`

- [x] Review sheet before Mark as Ordered
- [x] Success screen with Send link, WhatsApp and Print
- [x] Phone bar with four tabs plus More, badge on History
- [x] Icon rail kept until 1280 px for landscape tablets
- [x] One-tap item set chips
- [x] Delete and Deactivate moved into ⋯ with a confirmation
- [x] Missing-size chips in the Employees list
- [x] Compare with the same days of last month on the dashboard

**As built:** the account moved from the phone's top bar into More. Deactivate asks with
the browser's confirm dialog, like the existing Delete. The month comparison needed a small
API addition (`previous_to_date`, `through_day`).

### Phase 2: density (lists and composer) — done, `aee8829`

- [x] Compact order lines with steppers and size chips
- [x] Searchable Add item combobox
- [x] History status tabs, aging chips, order page
- [x] History list and detail pane on desktop
- [x] Attention-first dashboards with a prefilled Reorder
- [x] Confirmation page with the summary first and pinned consent
- [x] Tablet: one-column rows in portrait, list and detail in landscape

**As built:** the History tabs still open on All; Awaiting is one tap away. The
confirmation page first kept the full bilingual record visible below the summary; the
follow-up below moved it behind one tap, as option A in section 7 proposes. Reorder uses the
quantity given last time, which the API now returns with each replacement.

### Phase 3: delight (speed for power users) — done, `a663ce0`

- [x] ⌘K palette and keyboard shortcuts
- [x] "Due now" suggestions in Create Order
- [x] Due-date bars on the employee page
- [x] Item pictograms
- [x] Drafts that survive a closed tab
- [x] Hand-over mode on the counter tablet

**As built:** hand-over records a new confirmation method, `IN_PERSON` (migration 0009),
with the staff member as giver; the manual defines only electronic and paper. Pictograms
are an icon field on each item (migration 0008), guessed from existing names. Drafts are
kept in localStorage per user on the device, cleared by Sign out.

### Since phase 3 — done, `13214e8`, `65da1ad`, `c0cf0bc`, `acfc5b6`, `1dcc4ed`, `c089c1a`, `7edcdcc`, `312676a`, `49a1ce3`, `b9cda4d`, `9213136`, `f8e3982`, `121644f`

- [x] Search by record number in the ⌘K palette: `WE-000004`, `we4` or `4` lists that
  order first, and Enter opens it in History (History's new `record` filter)
- [x] Dashboard figures with a list behind them are tappable: Awaiting and On order open
  History on the Awaiting tab, Replacements due opens the Replacements due screen, Missing
  sizes opens Employees filtered
- [x] A **Replacements due** screen (`/replacements`): every replacement due within 30
  days across all employees, not just the dashboards' first 8, with tabs All · Overdue ·
  Due soon, the item, size and quantity given, the due date and receipt, and Reorder on
  each row. It restores, as its own screen, the full list that phase 2 folded into Needs
  you
- [x] Missing sizes names the person and what they lack ("Rasa Stankevičiūtė: no shoe
  size") instead of "1 employee to measure"
- [x] Employee confirmation as option A in section 7: the task, the items and the
  confirmation statement first; the full bilingual record one tap away; the consent at the
  bottom of the screen; an EN / RU interface switch; and a confirmed screen that says when
  the receipt was recorded. Hand-over mode uses the same parts
- [x] Create Order as option A in section 3, with the desktop summary panel: saved sizes under Assigned to, ✓ on sets already on the order, one Review button, WhatsApp and "Create the confirmation link as well" in the review, the link ready on the success screen, and ↑ / ↓ on quantities
- [x] Print Record fits one A4 page: in print the app shell no longer keeps the navigation's narrow grid column, which had spread a five-line record over three pages; rows and the signature block no longer split across pages
- [x] Phone navigation option B from section 2: a raised New order button in the middle of the bar, labelled Draft with the line count while a draft is saved
- [x] History option A from section 4 completed: two-line rows under month headings on a phone, with the sort order and time-zone note moved into Filters
- [x] Sign in: a Show / Hide password button inside the password field
- [x] Shorter confirmation wording for new orders (`2026-09-v2`), versioned per order so placed and confirmed records keep their text and hash; the printed record fills in the employee's name on the signature line
- [x] Dashboards option A from section 5 completed on phones: compact figure tiles with one fact beside each figure, Refresh as an icon, and a counted Needs you on the first screen, on all three dashboards
- [x] Records lists option A from section 6 completed: Employees, Item Catalogue and Users as short two-line rows on a phone that open the record's page, where its actions are; All / Missing a size and Catalogue status chips; size-group headings; Item Sets with a total and Use in new order; Reset password under ⋯
- [x] History option C from section 4 completed: one-line rows beside the open order on desktop, Escape to close it, and a J / K / Esc hint in the pane

### Still open

- **Shop grid** in Create Order: deferred until the catalogue passes about 30 items, as
  section 3 recommends. The pictograms it needs are in place.
- **Hallway test**: the five-user test of the phone Create Order, timing "apply the
  starter kit, change one size, send", was not run before building. Running it now would
  measure the new flow.
- **Product owner sign-off** for in-person confirmation, which goes beyond the manual; and
  iPad Guided Access on any tablet left at a counter.
- **Legal sign-off** for confirmation with the full record collapsed behind View full
  record. The confirmation statement is quoted on the first screen; if that is not enough,
  require opening the record once before Confirm.

Each phase updated the e2e suite, `web/AGENTS.md` and `docs/testing.md`. The responsive
rules still hold: one Main nav, 44 px touch targets, sticky actions above `--bottom-nav`,
and no sideways scrolling at 375, 768, 920, 1100 and 1280 px.

---

## 11. References

1. Apple Human Interface Guidelines,
   [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars):
   keep tabs few, with short full labels.
2. Material Design 3,
   [Navigation bar](https://m3.material.io/components/navigation-bar/guidelines):
   3–5 destinations; use other navigation beyond that.
3. W3C,
   [WCAG 2.2 SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html),
   plus 2.5.5 (44 px, enhanced) and 2.5.1 Pointer Gestures.
4. Nielsen Norman Group,
   [10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/),
   especially #1 visibility of status, #5 error prevention and #8 minimalist design.
5. Nielsen Norman Group, [Mobile tables](https://www.nngroup.com/articles/mobile-tables/):
   card and list transformations, and when to drop columns.
6. Steven Hoober, research on how people hold phones and reach with the thumb: primary
   actions low and central.
7. Command palette patterns in Linear, GitHub and Slack (⌘K): search across entities and
   actions.
