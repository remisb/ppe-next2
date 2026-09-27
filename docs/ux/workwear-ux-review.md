# Workwear UX Review

UX research report for Workwear & Equipment (PPE-next2). It reviews all 15 screens at
phone (375 px) and desktop (1280 px) widths. For each problem area there are two or three
design options, each with a sample screen, pros and cons, and a recommendation.

27 Sep 2026 · build `1ff7a0c` · demo data · roles: admin, manager, employee

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
8. [Desktop power layer](#8-desktop-power-layer)
9. [Roadmap](#9-roadmap)
10. [References](#10-references)

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

### Top ten recommendations

| # | Change | Screen | Platform | Impact | Effort |
|---|---|---|---|---|---|
| 1 | Add a review sheet before Mark as Ordered, and show the next steps after it (confirmation link, WhatsApp, print) | Create Order | Both | High | S |
| 2 | Phone bar with four tabs plus More. Move Catalogue, Item Sets, Users and Account into More | App shell | Phone | High | S |
| 3 | Compact order lines: size chip and a −/+ quantity stepper on one 64 px row, with price details on tap | Create Order | Phone | High | M |
| 4 | Apply an item set with one tap on a chip (today it takes a select plus Apply). Add items from a search field | Create Order | Both | High | S |
| 5 | History status tabs (Awaiting · Given · All) with counts, a "days waiting" chip, and 64 px rows that open the record | History | Phone | High | M |
| 6 | Replace the Actions column with a list and a detail pane beside it | History | Desktop | Med | M |
| 7 | Put what needs attention first on the dashboard: 2×2 figures, then a "Needs you" list where each item has one action | Dashboards | Both | Med | M |
| 8 | List rows open the record's page. Move Delete and Deactivate out of every card into a ⋯ menu. Flag missing sizes in the list | Employees, Catalogue | Both | Med | S |
| 9 | Confirmation page: put a summary first and keep the consent bar pinned to the bottom of the screen | Employee confirmation | Phone | High | S |
| 10 | A ⌘K command palette and keyboard shortcuts in Create Order | All | Desktop | Med | M |

---

## 1. Method

- **Walkthrough.** Every route was opened as an administrator against the local demo data,
  at 375×812 and 1280×800. Create Order was run end to end: pick an employee, apply
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

#### B. Raised "New order" button (alternative)

The main job, preparing an order, gets a raised button in the centre of the bar, where
the thumb rests. If a draft exists, the button reopens it and shows a line count.

| Pros | Cons |
|---|---|
| The primary task is visible and reachable from every screen | Can feel like a consumer app |
| Common in field-service and logistics apps | An icon-only button needs a visible label or tooltip |
| | Draft handling (resume or start new) makes the behaviour ambiguous |

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

### Options

#### A. Compact composer with a review sheet (recommended)

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

#### Desktop A: lines beside a sticky summary panel

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

### Options

#### A. Status tabs, compact rows, order page (recommended on phone)

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

#### B. Slimmer cards: one action plus ⋯ (low-effort step)

Keep `<Table stack>` and its cards. Each card shows the next action for its status (Send
link, or View record) with a secondary style, and the rest goes into ⋯.

| Pros | Cons |
|---|---|
| A small change that stays inside the existing Table stack rule | Still roughly half the density of A |
| Actions stay one tap away | A ⋯ menu hides actions such as Print from new users |
| Cards drop to about 120 px, so about 4 fit per screen | |

#### C. List and detail (recommended on desktop ≥ 1200 px)

*Sample: tabs Awaiting · 3 / Given · 3 / All · 6 above a one-line table (Record,
Employee, Ordered, Waiting chip, Value). The selected row WE-000004 opens a right-hand
pane with its lines, the total, "Send confirmation link", "Print", "Paper signed…" and a
`J`/`K` hint.*

| Pros | Cons |
|---|---|
| Rows go back to one line (about 36 px); the only primary button is in the pane | Needs width; between 768 and 1200 px it falls back to the order page from A |
| Chase several waiting orders without leaving the list (J/K) | The selected row must be kept in the URL so Back and refresh work |
| Items are visible without "View Items" expanding rows | |

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

### Options

#### A. Attention first (recommended)

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

### Options

#### A. Row list and record page (recommended)

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

#### Catalogue: grouped rows with status chips (applies A)

Status filter chips (Active 9 · Incomplete 1 · Inactive 1) replace the Status column.
Grouping by size group (Clothing, Shoes, No size) mirrors how sizes are resolved.
Deactivate moves to the item page.

| Pros | Cons |
|---|---|
| The one blocking item stands out | Grouping and a manual "display order" sort can conflict; pick one as the default |
| Prices line up on the right for quick comparison | |

**Desktop:** keep the tables, but move row actions into a ⋯ menu that appears on hover
and focus. Keep one quiet inline action per row ("Edit sizes" for Employees). Item Sets
cards gain a total ("5 items · €274.90") and a "Use in new order" link. On Users, "Reset
password" moves into ⋯ as well.

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

### Options

#### A. Summary first, consent pinned to the bottom (recommended)

The first screen says in plain words what is asked, lists the items, and pins the consent
to the bottom. The full bilingual document is one tap away and unchanged. The EN/RU
switch changes only the interface; the legal document stays bilingual.

```
┌──────────────────────────────────┐      ┌──────────────────────────────────┐
│ ⛑                      [EN] RU   │      │                                  │
│ Ona, please confirm you received │      │               ✓                  │
│ 5 items                          │      │        Receipt confirmed         │
│ Order WE-000002 · from           │      │ Thank you, Ona. WE-000002 is     │
│ Administrator · 30 Jul           │      │ recorded as given on 1 Aug 2026  │
│ Safety shoes · 39             ×1 │      │ at 14:02. You can close this page│
│ Work jacket · S               ×1 │      │ Получение подтверждено. Эту      │
│ Work trousers · S             ×2 │      │ страницу можно закрыть.          │
│ Protective gloves            ×10 │      │          [ View record ]         │
│ Safety helmet                 ×1 │      │                                  │
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

## 8. Desktop power layer

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
  status, so users don't have to navigate away.
- **Relative dates:** show "3 days ago" in lists with the exact time in a tooltip.
  Receipts keep absolute dates.

---

## 9. Roadmap

### Phase 1: quick wins (safety and orientation)

- Review sheet before Mark as Ordered
- Success screen with Send link, WhatsApp and Print
- Phone bar with four tabs plus More, badge on History
- One-tap item set chips
- Delete and Deactivate moved into ⋯ with a confirmation
- Missing-size chips in the Employees list
- Compare with the same days of last month on the dashboard

### Phase 2: density (lists and composer)

- Compact order lines with steppers and size chips
- Searchable Add item combobox
- History status tabs, aging chips, order page
- History list and detail pane on desktop
- Attention-first dashboards with a prefilled Reorder
- Confirmation page with the summary first and pinned consent

### Phase 3: delight (speed for power users)

- ⌘K palette and keyboard shortcuts
- "Due now" suggestions in Create Order
- Due-date bars on the employee page
- Item pictograms, and later the shop grid
- Drafts that survive a closed tab (localStorage or the server)

Each change touches the e2e suite and `web/AGENTS.md`. The responsive rules still hold:
one Main nav, 44 px touch targets, sticky actions above `--bottom-nav`, and no sideways
scrolling at 375–1280 px. A "row list" variant needs adding next to `<Table stack>`. Run a
five-user hallway test of the phone Create Order (Phase 2) before building it, timing
"apply the starter kit, change one size, send".

---

## 10. References

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
