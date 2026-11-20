# Record actions: list, detail pane and the action bar

A proposal for one system-level pattern for **list and detail** screens: how the open record
lines up beside its list, and how its actions (the main action, the other actions and
**⋯ More actions**) are laid out so that they fit **in every language** without moving the
record's title. Four options, a recommendation, the rules of the design system that carries
it, and a rollout. The companion [record-actions.html](record-actions.html) draws each option
live in English, Lithuanian and Russian at a phone's and a pane's width.

18 Nov 2026 · build `7070a52` · code review, the running app (`localhost:5180`) in English and
Russian at 1280px and 375px, and every action label measured in the app's font (Geist 500
14px) · paths are under `web/`, `ui` = `packages/ui/src/components`, `ww` =
`apps/workwear/src`.

Status: **proposal**. It builds on [screen-header-toolbar.md](screen-header-toolbar.md) §6
(the record row) and [ui-ux-guidelines.md](ui-ux-guidelines.md) §2 (the detail pane), and
changes three of their decisions: the record row holds only the record's identity and never
wraps, the actions move to a bar of their own under it (with the body's row of buttons), and
their overflow is decided by the words' real width rather than by breakpoints.

---

## Summary

- **The record's title moves when its actions are long.** `RecordHeader` puts the title and
  the actions in one `flex-wrap-reverse` row (`ui/record-header.tsx:84`). When they do not
  fit, the actions stay on top and the title drops under them. Beside a list the record's
  number then no longer lines up with the screen's title; on a phone the back arrow leaves its
  corner and sits on the second line. This is the misalignment.
- **It happens in English too.** The order pane's row has about **163px** for its main action
  (pane 26rem; 99px at its 22rem minimum). *Create confirmation link* with its icon is
  **213px** in English, 243px in Lithuanian and **307px** in Russian. The short words on a
  phone (*Создать ссылку*, 165px) still exceed the phone's 122px.
- **Labels differ by up to 1.6× between languages** (table below), and nothing checks a
  label against the room it gets. Breakpoint-based overflow (`showFrom`) cannot know the
  language, so it is right in English and wrong in Russian.
- **A record's actions live in three places with three looks**: the row (main action,
  ⋯), a row of outline buttons in the body (*Print Order*, *Mark as Signed & Given*, which
  stack full width on a phone and wrap beside a list) and ⋯. The SIM card already mixes an
  icon-only key (*Show PIN and PUK*) with a labelled *Return*; ⋯ is 36px in a record and 44px
  in a screen header.
- **Recommendation: Option B**, *the title on a row of its own, and an action bar under it*:
  the main action with its words, the other actions as **icon tools** with their names on
  hover and focus (the suggestion), ⋯ at the end, all on one line that never wraps. One
  **action model** per record kind feeds it, and the bar collapses in a fixed order (full
  words → short words → fewer tools → icon-only main action) by measuring its room.
- **Measured, not guessed.** For 5 records × 3 widths × 3 languages (45 cases), the bar under
  the title keeps the main action's words (full or short) in **45 of 45** with every tool
  visible. Squeezed into the title row instead (Option C), it keeps them in only **13 of 45**:
  the title and ✕ leave too little room, and the same record then looks different in each
  language.

---

## 1. What the app does today

Screenshots are in `img/record-actions/` (dark theme, 1280×800 and 375×760).

| Shot | What it shows |
|---|---|
| `order-en-1280.jpg` | English, WE-000010 beside Orders: *Create confirmation link* and ⋯ sit on the first line, **WE-000010 drops to the second**, 20px below the screen's title *Orders*. |
| `order-ru-1280.jpg` | Russian: the same, and *Отметить как подписанный и выданный* takes a row of its own under *Печать заказа*. |
| `order-ru-375.jpg` | Russian phone: *Создать ссылку* and ⋯ alone on the first line, ← and the number on the second; the two body buttons stack full width. |
| `sim-ru-1280.jpg` | Russian SIM card: *Принять* (labelled) next to 🔑 (icon only) and ⋯; the card's top edge cuts the row. |
| `sim-ru-375.jpg` | Russian phone: the actions on a line of their own, ← under them beside the phone number. |

### F1. The title gives way to the actions

`RecordHeader`'s row is `flex flex-wrap-reverse … justify-between`: title first, actions
second, wrapped in reverse so the actions stay on top. The guidelines chose this ("where the
title and the actions do not fit one row, the title moves under them, never the actions
down"). It keeps the main action in the corner, but it gives up the title's place, and the
pane's top was aligned with the screen header (`-mt-8`, `lg:-top-4`, `--page-header`) for a
row of **one** line. Two lines break that alignment and make the sticky row twice as tall.

### F2. Labels are not sized for the room

Width of each action as a button (Geist 500 14px, 16px padding each side, without its icon;
add 22px with one):

| Action | EN | LT | RU | Where today |
|---|---:|---:|---:|---|
| Create confirmation link | 189 | 219 | **283** | order row |
| ↳ short: Create link | 103 | 137 | 141 | order row, phone |
| Mark as Signed & Given | 187 | 262 | **305** | order body |
| View Order | 105 | 166 | 132 | order row |
| Print Order | 104 | 172 | 130 | order body |
| Copy for WhatsApp | 159 | 167 | 212 | order ⋯ |
| New order | 100 | 155 | 118 | employee row |
| Edit details | 105 | 166 | 153 | employee ⋯ |
| Edit | 57 | 99 | 99 | item row |
| Give Asset | 102 | 113 | 163 | asset row |
| Give SIM | 90 | 106 | 112 | SIM row |
| Return | 76 | 74 | 90 | asset row |
| Show PIN and PUK | 155 | 145 | 165 | SIM row (icon only) |
| Mark as Not Returned | 176 | 199 | 251 | asset ⋯ |
| Prepare Activation Email | 192 | 209 | 268 | SIM ⋯ |

Characters: the longest Russian labels run 31–35 characters against 22–24 in English.

### F3. The room a record's row has

| Where | Row width | Taken by the rest | Left for actions |
|---|---:|---|---:|
| Pane beside a list, 26rem | 384 | title *WE-000010* 117, ✕ 44, gaps | ~215 (163 with ⋯) |
| Pane beside a list, 22rem (its minimum) | 320 | the same | ~150 (99 with ⋯) |
| Phone, 375 | 343 | ← 44, title 117, gaps | ~170 (122 with ⋯) |
| Record page, desktop | ~720 | ←, title | ~560 |

A person's name or an item's name as the title (*Aleksandr Ivanov*, 165px) leaves less.

### F4. Actions in three places

| Record | In the row | In the body | In ⋯ |
|---|---|---|---|
| Order, ordered | Create confirmation link | Print Order · Mark as Signed & Given | Copy for WhatsApp · Delete order… |
| Order, given | View Order | Print Order | Copy for WhatsApp · Delete order… |
| Item | Edit | – | Deactivate item… |
| Employee | + New order | (Edit beside Sizes) | Edit details · Merge with… · Delete employee… |
| SIM card | Give SIM / Return · 🔑 | Change status ▾ (in Connection) | Edit · Print Form · Mark as Not Returned · Prepare … Email |
| Equipment | Give Asset / Return | – | Edit · Print Form · Mark as Not Returned |
| Audit change, error | – | – | – |

The body row (`grid gap-2 sm:flex sm:flex-wrap`, `ww/components/order-detail.tsx:274`) is
the only place a Russian label gets a full row, and on a phone it stacks.

### F5. Small inconsistencies that add up

- ⋯ is `icon-sm` (36px, 44 on touch) in a record (`ui/more-actions.tsx`) and `icon` (44px) in
  a screen header.
- The SIM card's 🔑 is the only icon-only action (`ww/components/sim-codes.tsx:70`), so it
  reads as a different kind of thing from *Return* beside it.
- The main action is filled on an asset (*Give SIM*), outline on an item (*Edit*) and filled on
  an order and an employee.
- The order's row and its list row's ⋯ are built by `historyActions`; the other records build
  their header and their row ⋯ separately.

---

## 2. What the system must guarantee

1. **The record's identity never moves.** ←, the title and ✕ keep their place at every width
   and in every language; the title is on the first line, level with the screen's title.
2. **The action row is one line.** It never wraps; what does not fit collapses in a fixed,
   documented order, ending in ⋯.
3. **Decided by the real words.** Fitting uses the width of the words in the language in use,
   not breakpoints tuned in English.
4. **One action model per record kind**, read by the row, the list row's ⋯, and later ⌘K: the
   same names, icons, order and confirmations everywhere.
5. **Touch and screen-reader parity.** Every icon-only control has its full name as its
   accessible name, in a tooltip on pointer hover and on keyboard focus, and in ⋯'s list or a
   long-press on a touch screen. Nothing is reachable by hover only.
6. **Destructive and asking actions are never one tap away**: they are labelled, in ⋯, last,
   after a separator, ending in "…".

---

## 3. Options

All four keep the guarantees of §2 and the same action model; they differ in where the
actions sit and how much they say. The HTML draws each one for two orders, a SIM card, an
employee and an item, in EN/LT/RU, at 375px, 22rem and 26rem, and measures where each lands.

### Option A: Icon toolbar in the title row (as suggested)

```
[←] WE-000010                               [🔗][🖨][✍] [⋯] [✕]
```

Every action is a 44px icon button; the main one is filled, the others outline (or ghost).
Its name shows in a tooltip on hover and focus and is its accessible name. ⋯ holds the rest
with labels. At most 3 icons beside a list, 2 on a phone, then ⋯.

- **+** Fixed width (44px per action) whatever the language: the row is identical in EN, LT
  and RU, so the title always lines up. The fewest pixels. Simple to build: no measuring when
  the caps per width are fixed.
- **+** Already the pattern of the SIM card's 🔑, GitHub's and Gmail's message toolbars.
- **−** Recognition: *Create confirmation link*, *Mark as Signed & Given*, *Give SIM* and
  *Prepare Activation Email* have no icon people know. The main action, the one the screen is
  for, becomes a symbol.
- **−** Touch screens have no hover: the name needs a long-press (a pattern few users try) or
  a trip into ⋯. The guidelines' touch-parity rule (§3) only allows a hover tooltip to repeat
  what is shown.
- **−** Needs an icon for every action, and one meaning per icon across both apps.

### Option B: Title row, then an action bar (recommended)

```
[←] WE-000010                                              [✕]
[🔗 Create confirmation link] [🖨] [✍]                      [⋯]
```

The first row is identity only (←, title, ✕): one line, `--page-header` tall, the screen
header's twin, so it lines up with it in every language by construction. The second row is
the **action bar**: the main action, filled, **with its words**; the other actions as
**tools**, icon-only buttons with their names in a tooltip, allowed only for actions whose
icon is in the app's **icon vocabulary** (§5); ⋯ at the end with everything else, labelled.
Both rows stick; the body's row of buttons goes. When the bar is short of room it collapses
in this order, one step at a time, until it fits:

1. the main action's full words, all tools (at most 3; 2 on a phone);
2. the main action's **short words** (`ShortWords`, required when the full words exceed the
   budget, §3);
3. tools move into ⋯, the last first, down to none;
4. the main action becomes **icon only** (filled, still first), its words in the tooltip and as
   its name.

Measured over the 45 cases (HTML, "What the main action shows"): step 1 in 37, step 2 in 8
(*Create confirmation link* in LT and RU, and on phones), steps 3 and 4 never.

- **+** The title never shares its row: alignment is fixed in every language, not tuned.
- **+** The action people come for keeps its words everywhere; tools look the same in every
  language. It is the pattern of Fluent's command bar, Fiori's object page and Primer's
  ActionBar (icon buttons overflowing into a menu).
- **+** The whole pane width for the bar (320–384px; 343px on a phone).
- **−** A second sticky row: about 52px more of the screen held by the header (≈108px on a
  phone with the bar under the title).
- **−** Needs measuring (one `ResizeObserver` per bar) and a pure layout function to test.
- **−** Tools rely on the vocabulary; an action without an icon there goes to ⋯, a tap more.

### Option C: One row, labelled main action, icon tools, ⋯

```
[←] WE-000010                [🔗 Create link] [🖨][✍] [⋯] [✕]
```

B's bar squeezed into the title row: one row, as today, but it **never wraps**; the same
ladder, with the title keeping its width (a record number cut short is no identity).

- **+** One row; the title never moves.
- **+** Words for the main action in English beside a wide pane.
- **−** Measured: the main action is an icon in **32 of 45** cases: every phone, most of
  Lithuanian and Russian, and the employee (a person's name is a long title) even in English.
  In practice it is Option A, but only in some languages.
- **−** The same record looks different in each language, which is what this proposal sets out
  to end.

### Option D: Sticky action footer

```
[←] WE-000010                                              [✕]
  … facts, lines, sections …
[ 🔗 Create confirmation link ][ 🖨 Print Order ][⋯]   ← sticks at the pane's bottom
```

The header holds identity only; the actions are a bar along the bottom of the pane (beside a
list) or of the screen above the bottom tab bar (phone), labelled, two equal buttons and ⋯,
words allowed on two lines.

- **+** Thumb reach on a phone; the most room for words; the title row is never touched.
- **−** On a phone it stacks on the tab bar (two bars of ~56px each) or must replace it while a
  record is open, which changes navigation.
- **−** Beside a list, the actions sit far from the title and below the fold of a long order;
  the eye has learned the top-right corner from every screen header (screen-header-toolbar
  §4: "the primary sits at the end, next to ⋯").
- **−** Two-line buttons in Russian are tall and uneven.

### Cross-cutting: label budgets (with any option)

Whatever the layout, labels need budgets, checked by a test:

| Kind | Budget (Geist 500 14px) | ≈ characters | When over |
|---|---:|---:|---|
| Main action, full words | 200px | 24 | needs `short` |
| Main action, short words | 120px | 14 | reword |
| A tool's name (tooltip, ⋯) | none | – | – |
| A list row's ⋯ item | 280px | 36 | reword |

Russian rewording candidates: *Создать ссылку для подтверждения* → **Ссылка на подпись**
(short: **Ссылка**); *Отметить как подписанный и выданный* → **Подписан и выдан**;
*Подготовить письмо об активации* → **Письмо об активации**. Lithuanian: *Pažymėti kaip
pasirašytą ir išduotą* → **Pasirašyta ir išduota**. Glossary changes go to
`docs/ubiquitous-language.md` first.

---

## 4. Comparison

| | A Icon toolbar | B Title row + action bar (rec.) | C One row, label + tools | D Footer |
|---|---|---|---|---|
| Title never moves | ✓ | ✓ | ✓ | ✓ |
| Looks the same in EN, LT, RU | ✓ identical | ✓ (main may use short words) | ✗ words in EN, icon in RU | ~ (two-line words in RU) |
| Main action keeps its words, of 45 | 0 | **45** | 13 | 45 |
| Works without hover (touch) | weak | ✓ main has words; tools in ⋯ on touch | weak | ✓ |
| Sticky header height | 1 row | 2 rows (+52px) | 1 row | 1 row + footer |
| Measuring needed | no (fixed caps) | yes | yes | no |
| Body button row removed | ✓ | ✓ | ✓ | ✓ |
| Change to today's look | large | medium | small | large |
| Effort | S | M | M | L |

---

## 5. The recommended system (Option B)

### Anatomy of list and detail

```
┌ screen header (--page-header, sticky) ─────────┐┌ record row (same height, sticky in the pane) ──┐
│ Orders                       [+ Create Order]  ││ [←] WE-000010                               [✕] │
├ filter bar ────────────────────────────────────┤├ action bar (sticky under it) ───────────────────┤
│ list / table                                   ││ [🔗 Create confirmation link] [🖨] [✍]      [⋯] │
│                                                │├ details line, badges (scroll) ──────────────────┤
│                                                ││ facts (FactGrid)                                │
│                                                ││ sections (DisclosureSection, closed)            │
│                                                ││ Changes                                         │
└────────────────────────────────────────────────┘└─────────────────────────────────────────────────┘
```

- The record row is exactly `--page-header` tall (one line, `flex-nowrap`) and holds only
  identity, so its title's baseline is the screen title's in every language. The pane's
  negative margins (`-mt-8`, `lg:-top-4`) stay correct because the row's height is now fixed.
- Record row, left to right: **←** (below `lg`) · **title** (`min-w-0 flex-1`, truncates beside
  a list with the full title as its tooltip; `line-clamp-2` on a page) · **✕** (beside a list).
- Action bar, left to right: **main** (filled, words) · **tools** (outline, icon only) · space ·
  **⋯** (ghost, at the end). It sticks under the record row (`top: --page-header`) and takes
  the row's rule when stuck; it is 44px tall plus 8px below. A record with no actions (an
  audit change, an error) has no bar.
- On a record's page at desktop width the bar keeps its own row too, so a record reads the
  same in a pane, on a phone and on its page.
- No other row of record-level buttons in the body. Actions that belong to one part of the
  record stay with that part: *Give SIM* in Assignments' heading, *Upload Signed Form* on an
  assignment, *Change status ▾* in Connection, *Edit* beside Sizes.

### The action model

One function per record kind returns its actions for the record and the signed-in user, read
by the record row and the list row's ⋯ (and later ⌘K). A sketch for `@ppe/ui`:

```ts
export interface RecordAction {
  id: string
  /** Full words: the accessible name, the tooltip, the item in ⋯. */
  label: string
  /** Words for the bar when `label` is over the budget: "Create link". */
  short?: string
  /** From the icon vocabulary. Without one, never icon-only: a tool without an icon is a ⋯ item. */
  icon?: LucideIcon
  /** Where it starts: the one main action, a tool in the row, or ⋯ only. */
  place: 'main' | 'tool' | 'menu'
  /** Destructive, red in ⋯. */
  destructive?: boolean
  /** Asks first: "…" at the end of its label, last in ⋯ after a separator. */
  asks?: boolean
  /** Why it cannot be used now, shown in its tooltip; the control stays visible. */
  disabledReason?: string
  run: () => void
  href?: string
}

// ww/lib/order-actions.ts
export function orderActions(o: Order, can: Can, run: OrderRunners): RecordAction[]
```

`RecordHeader` takes `actions: RecordAction[]` instead of a `ReactNode`; `MoreActions` in a
list row takes the same array (every action as an item, the main one first).

### ActionBar: the collapse ladder

- A pure function `layoutActions(widths, room)` returns which step of the ladder fits
  (§3 B: full → short → fewer tools → icon main) and which actions go into ⋯. It is unit
  tested with widths as numbers. The HTML's playground runs the same ladder (`ladder()`).
- The component measures the row's room with one `ResizeObserver` and the words' widths once
  per language (a hidden copy of the bar, as Primer's ActionBar does), then renders the
  chosen step. Rendering is deterministic for a width and a language; print shows no actions.
- Caps on top of the fit: at most **3 tools** beside a list or on a page, **2** on a phone.
- Tools moved into ⋯ come first in it, in the bar's order, then a separator, the menu-only
  actions, a separator and the asking ones.
- ⋯ is 44px in every header (records and screens alike) and shows only when it holds
  something.

### Icons and names

- **Vocabulary**: one meaning per icon, across both apps; an action may be a tool only with one
  of these. Kept as a typed map in `@ppe/ui` so a second meaning fails review.

| Icon (lucide) | Means | Used by |
|---|---|---|
| `Pencil` | Edit | item, employee details, asset |
| `Printer` | Print | Print Order, Print Form |
| `Link2` | Confirmation link | Create confirmation link |
| `FileText` | Open the document | View Order |
| `Signature` | Mark as signed | Mark as Signed & Given (not `PenLine`: at 16px it reads as `Pencil`) |
| `KeyRound` | Show PIN and PUK | SIM card |
| `Mail` | Prepare an email | activation, blocking |
| `MessageCircle` (green) | WhatsApp | Copy for WhatsApp |
| `Copy` | Copy | numbers |
| `Plus` | New / Add | New order, Add … |
| `Undo2` | Take back | Return |
| `Trash2` | Delete | ⋯ only, never a tool |

- **Tooltip**: on hover after 300ms and on keyboard focus (the existing `Tooltip`), the full
  `label`, plus `disabledReason` when disabled. On a touch screen a long-press (500ms) shows
  it without running the action; ⋯ also lists every tool by name at the top on a touch screen
  (`pointer-coarse`), so the names are never hover-only.
- **Accessible name** is always `label`; `short` is `aria-hidden` (as `ShortWords` does now).

### Label budgets, tested

- A Vitest test over each app's dictionaries checks every `RecordAction` label used as a main
  action against the budget in characters (§3 table) and fails when one is over without a
  `short`.
- An e2e step, beside "no screen scrolls sideways": for each record kind, in EN, LT and RU
  (the test user's language switched through the API), at 375, 1024 and 1280px, the record
  row is one line (`clientHeight` equals `--page-header`) and the title's top equals the
  screen title's beside a list.

---

## 6. Per record (Option B)

| Record | Main (short) | Tools | ⋯ |
|---|---|---|---|
| Order, ordered | 🔗 Create confirmation link (Create link) | 🖨 Print Order · ✍ Mark as Signed & Given | Copy for WhatsApp · — · Delete order… |
| Order, given | 📄 View Order (View) | 🖨 Print Order | Copy for WhatsApp · — · Delete order… |
| Item | ✎ Edit | – | Deactivate item… |
| Employee | + New order | ✎ Edit details | Merge with… · — · Delete employee… |
| SIM card, in the office | Give SIM | 🔑 Show PIN and PUK | Edit · Print Form · Prepare Activation Email · Prepare Blocking Email |
| SIM card, held | ↶ Return | 🔑 Show PIN and PUK · 🖨 Print Form | Edit · Prepare … Email · — · Mark as Not Returned… |
| Equipment | Give Asset / ↶ Return | 🖨 Print Form | Edit · — · Mark as Not Returned… |
| Audit change, error, Manage apps' app | as today | – | – |

*Give SIM* and *Give Asset* keep their words (no vocabulary icon for "give"); in step 4 they
take `Send` only if the vocabulary adopts it, else they stay labelled and the tools go first.

---

## 7. Rollout

1. `layoutActions` and its tests; `RecordAction` and the icon vocabulary in `@ppe/ui`.
2. `RecordHeader`'s row holds identity only and renders an `ActionBar` under it (one line,
   never wraps, sticky); `MoreActions` reads the same
   array; ⋯ at 44px.
3. Orders: `orderActions` from `historyActions`; the body's button row goes.
4. SIM cards and Equipment (`AssetMoreActions` becomes `assetActions`); then item, employee,
   and Administration's records (Manage apps).
5. Label budgets: the Vitest check, then the Russian and Lithuanian rewording through
   `docs/ubiquitous-language.md`.
6. The e2e step (one line, title aligned) in three languages.
7. Optional: `PageHeader`'s `showFrom` replaced by the same ladder, so screen headers fit by
   words too.

Docs with the change: `docs/ui-language.md` (*action bar*, *tool*, the ladder),
`docs/ux/ui-ux-guidelines.md` §2 and §10, `web/AGENTS.md`. The Help text and its screenshots
will be out of date for the order pane and the SIM card; they are updated separately.

---

## 8. Open questions

1. **Option B or A?** B spends a second row to keep the main action's words; A is one row,
   identical in every language, but turns *Create confirmation link* into 🔗. A cheap test:
   show both to two managers on a phone in Russian and ask them to send a confirmation link.
2. **Long-press on touch**, or only ⋯ listing the tools by name? Long-press is invisible;
   listing them in ⋯ costs a few lines in the menu.
3. **Should *Mark as Signed & Given* be a tool** (✍, 44px) or stay labelled in ⋯? It changes
   an order's state, so a person should read its words before tapping it; as a tool it would
   ask first, as it does now.
4. **Rewording in Russian and Lithuanian**: accept the shorter terms in §3, or keep the long
   ones and rely on `short`?
5. **Screen headers too** (rollout 7), or records only?
