# The employee's page: where people reach it from

A proposal for an **employee record page**: the employee at their own address, the width of
the screen, alongside the employee beside the Employees list that the app has today. It maps
every way the app reaches an employee now, compares four ways to navigate to the page,
recommends one, and lays out the page itself. The companion
[employee-page.html](employee-page.html) draws the options, the flows and the page at a
phone's, a tablet's and a desktop's width.

20 Nov 2026 · build `f247d36` · code review of the staff app (`ww` = `web/apps/workwear/src`,
`ui` = `web/packages/ui/src/components`).

Status: **proposal**. It builds on [record-actions.md](record-actions.md) (the record row and
its action bar, built in WARE-46) and [ui-ux-guidelines.md](ui-ux-guidelines.md) §2 (the
detail pane), and follows the pattern SIM cards and Equipment already use: a pane beside the
register, a page from everywhere else.

---

## Summary

- **Today an employee has one address, and it is a pane.** `/employees/<id>` always opens the
  Employees list with the employee beside it (22–30rem from `lg`, the whole screen below it).
  Every link to an employee lands there: from an order, a SIM card, Replacements, the
  dashboards and ⌘K.
- **The employee is the app's largest record** and gets one of its narrowest boxes: sizes,
  profile and notes, photos, Replacements due, Items given (a table with a replacement bar
  per line), Ordered, SIM cards and Equipment held, Identity, Changes. In 30rem the Items
  given table stacks and every section is one long column.
- **A link from elsewhere moves the person to another section.** From an order, the
  employee's name opens Employees with its list behind her. On a phone her ← says **Back to
  Employees** and goes to the list, not to the order the person came from
  (`ww/routes/employees.tsx:148`).
- **Recommendation: Option B with A.** The Employees list keeps its pane (browsing with
  J / K, checking sizes, merging). **Every other link opens the employee's page**, whose ←
  goes back to where the person came from. The pane gets **Open page** as a tool in its
  action bar. One component draws both, so they never differ. This is what SIM cards and
  Equipment do already (`/assets/sim-cards/<id>` beside the register, `/assets/<id>` from
  elsewhere).

---

## 1. How the app reaches an employee today

| From | Where | Opens today | What the person wanted |
|---|---|---|---|
| A row of the Employees list | `ww/routes/employees.tsx:147, 281` | the pane beside the list | to look through employees: the list matters |
| J / K with one open | `ww/routes/employees.tsx:153` | the next one in the pane | the same |
| An order's employee name | `ww/components/order-detail.tsx:203` | Employees, list and pane | that person |
| A SIM card's or Equipment's **Held by**, an assignment | `ww/components/asset-detail.tsx:234, 402` | Employees, list and pane | that person |
| A register row's holder | `ww/routes/assets.tsx:545` | Employees, list and pane | that person |
| An item's Orders | `ww/routes/catalogue-item.tsx:339` | Employees, list and pane | that person |
| Replacements due | `ww/routes/replacements.tsx:113` | Employees, list and pane | that person |
| The Employee Dashboard (Add sizes, items given) | `ww/routes/employee-dashboard.tsx:169, 212` | Employees, list and pane | that person, to add sizes |
| ⌘K | `ww/components/command-palette.tsx:232` | Employees, list and pane | that person |
| A merge, a merged record | `ww/routes/employees.tsx:375`, `ww/routes/employee.tsx:86, 435` | the kept one in the pane | the kept record, in the list |

Nine of the ten ways in are a person looking for **one employee**; only the list itself is
someone looking **through** employees.

### F1. The pane is too narrow for the record

The pane is `ListDetail`'s `lg` width, `minmax(22rem, 30rem)` (`ui/list-detail.tsx`). At
30rem the Items given table stacks into two-line rows, the Sizes and the profile sit one
under the other, and Photos shows two tiles a row. A manager checking what someone was given
and when it is due reads one long column, 2–4 screens tall for a person with a year of
orders.

### F2. Links from elsewhere change the section and lose the way back

`/employees/<id>` is the Employees screen with a record open. Following an employee's name
from an order marks **Employees** as the current section, draws the list the person did not
ask for, and the record's own way out (✕ beside the list, ← below `lg`) goes to that list.
The browser's Back still returns to the order; the app's own control does not.

### F3. Two kinds of record already behave differently

SIM cards and Equipment have both: a row opens the card beside its register
(`/assets/sim-cards/<id>`), and links from elsewhere, an employee's held assets and ⌘K, open
the card's page (`/assets/<id>`, `ww/routes/asset.tsx`), drawn by the same `AssetDetail` with a
`place` prop. Employees and catalogue items have only the pane. The glossary already speaks of
"the employee's page" (`docs/ui-language.md`, Record page), meaning the pane.

---

## 2. What the navigation must guarantee

1. **A link to a person lands on the person.** Not on a list the person did not ask for.
2. **The way out goes back to where the person came from**, named by it ("Back to
   WE-000010"), and to the Employees list only when they came from there or opened the
   address directly.
3. **The list keeps the quick look.** Browsing with J / K, ticking sizes, finding duplicates
   and merging stay beside the list, with its search and tab kept behind.
4. **One record, one look.** The pane and the page show the same parts in the same order with
   the same actions; the page only uses its width.
5. **Stable addresses.** Links already sent, bookmarks, the Help and the e2e suite keep
   working.

---

## 3. Options

The HTML draws each one as a flow and as screens.

### Option A: Open page from the pane

```
Employees list ──row──▶ pane beside the list ──[⤢ Open page]──▶ the employee's page
Order, SIM card, ⌘K ──▶ pane beside the list (as today)
```

The pane's action bar gets a tool, **Open page** (`Maximize2`), which opens the page. Nothing
else changes.

- **+** Smallest change; the person decides when the pane is too small. A known pattern
  (Gmail's and Linear's "open in full", Jira's "open issue").
- **+** The pane stays the one way in, so there is nothing new to learn.
- **−** F2 stays: every link from elsewhere still lands in the list, and its ← still goes to the
  list. A person following a name from an order needs two clicks to see her in full.
- **−** "Open page" is a choice people have to discover each time.

### Option B: The page from everywhere but the list (recommended with A)

```
Employees list ──row──▶ pane beside the list ──[⤢ Open page]──▶ the employee's page
Order, SIM card, Replacements, dashboards, ⌘K ──────────────────▶ the employee's page
the page ──[← Back to WE-000010]──▶ where the person came from
```

Links decide by intent: **inside the list**, a row opens the pane; **anywhere else**, a name
opens the page. The page's ← goes back in history, named by where the person came from, and
falls back to **Back to Employees** when the page was opened directly (a bookmark, a new tab).

- **+** Fixes F1 and F2: the person lands on the person, with the room the record needs, and
  the app's own way back returns them.
- **+** The pattern SIM cards and Equipment already follow (F3), so the app has one rule:
  *a register opens beside itself; everything else opens the page.*
- **+** The list keeps its quick look; J / K and merging are unchanged.
- **−** Two places draw the record. One component with a `place` prop (as `AssetDetail`)
  keeps them identical; e2e covers both.
- **−** A new address, and the section mark: the page belongs to Employees, so Employees stays
  the current section (as `ui-language.md`'s Section rule already says of a record page).

### Option C: The page replaces the pane

```
Employees list ──row──▶ the employee's page ──[← Employees]──▶ the list
```

The list stops opening a pane; every row and link opens the page.

- **+** One place for the record; the simplest model to explain.
- **−** Loses what the list is for: J / K through employees, the list beside the open one, the
  list's search and scroll kept while reading one. Checking ten people's sizes becomes ten
  round trips.
- **−** Breaks the app's list-and-detail rule (`ui-ux-guidelines.md` §2) for one list only.

### Option D: Tabs on the page

```
Aleksandr Ivanov                                         ✕
[+ New order] [✎]                                        ⋯
Overview · Items · Assets · Documents · Changes
```

Not a way in but a way through: the page split into tabs. It can go with A, B or C.

- **+** A short first screen for a person with a long history.
- **−** Hides parts behind a click; a person searching the page (Ctrl+F) misses the closed
  tabs, and a phone needs a scrolling tab row.
- **−** The record's parts are already `DisclosureSection`s, closed at first and counted, which
  give the short first screen without hiding what exists: each closed part is one counted
  line, so the employee's nine parts fit one screen of a desktop page. Revisit if the page
  grows parts that are long even when closed.

### Comparison

| | A Open page | **B Page from elsewhere + A** | C Page only | D Tabs |
|---|---|---|---|---|
| A link to a person lands on the person (F2) | ✗ | ✓ | ✓ | – |
| The way back returns to the origin | ✗ | ✓ | ✓ | – |
| The list keeps J / K and its pane | ✓ | ✓ | ✗ | – |
| The record gets the width it needs (F1) | on request | ✓ from links, on request from the list | ✓ | – |
| Same rule as SIM cards and Equipment | ✗ | ✓ | ✗ | – |
| Existing addresses keep working | ✓ | ✓ | changes what they open | ✓ |
| Effort | S | M | M | M |

---

## 4. Recommendation: B with A

1. **The Employees list keeps the pane.** A row, J / K, Escape and the merge flow are
   unchanged, at `/employees/<id>`.
2. **Every other link opens the employee's page**: the order's employee, a SIM card's and
   Equipment's Held by and assignments, the register's holder, an item's Orders, Replacements
   due, the Employee Dashboard and ⌘K. `linkTo` keeps an `href`, so a middle-click still opens
   a new tab.
3. **The pane's action bar gets Open page**, a tool with a new icon in `actionIcons`
   (`page: Maximize2`, "open as a page", one meaning), after the employee's other tools.
4. **The page's ← goes back where the person came from**: `back(fallback)` in `ww/app.tsx`
   (history when there is one), named by the place the link was in ("Back to WE-000010",
   "Back to SIM-000001", "Back to Replacements due"), else **Back to Employees**. The page has
   no ✕: it is not beside anything.
5. **One component, two places.** `routes/employee.tsx`'s record moves into
   `components/employee-detail.tsx` with `place: { page: true, onBack } | { page: false,
   onClose }`, as `AssetDetail`. Its parts lay out by the room they have (container queries),
   so the pane is today's column and the page uses its width (§5).
6. **On a phone the two look the same**: the pane is already the whole screen. What changes is
   the way back: from an order, ← returns to the order.

### The address

The pane keeps `/employees/<id>`: every link sent, the Help, the e2e suite and J / K use it.
The page needs another address under Employees, so the section stays marked:

| Candidate | For | Against |
|---|---|---|
| **`/employees/<id>/page`** (recommended) | Under its section; says what it is; no new term | A word in the address |
| `/people/<id>` | Short | A new term the glossary does not have ("Employee" is the term) |
| `/employees?open=<id>` for the pane, `/employees/<id>` for the page | The record's own address is the page | Changes what every existing link opens |

---

## 5. The page itself

```
┌ screen ───────────────────────────────────────────────────────────────────────────────┐
│ [←] Aleksandr Ivanov                                                                   │  record row
│ [+ New order] [✎] [⤢]                                                              [⋯] │  action bar
│ Code W-006 · Prefers Russian                                                           │
├──────────────────────────────────────────────────────┬────────────────────────────────┤
│ Replacements due: 2 items · [Order them]             │ Sizes            [✎ Edit]      │
│ Items given (12)  ▾  ─ a real table, one line a row │ Height 189 · Clothing 2XL …    │
│ Ordered, not given (1)                               │ Profile: language, notes       │
│ SIM cards (1) · Equipment (2)                        │ Photos (2)                     │
│                                                      │ Identity: valid until …        │
├──────────────────────────────────────────────────────┴────────────────────────────────┤
│ Changes                                                                                │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Header**: the record row and action bar of record-actions.md, the page's title an `h1`
  (`RecordTitle as="h1"`), up to two lines; no ✕.
- **From the page's `@4xl` (about 56rem)**: two columns. The main one holds what is about
  things given and held, the reason people come (Replacements due, Items given as a table,
  Ordered, SIM cards and Equipment held); the side one, `20rem`, holds the person (Sizes,
  profile, Photos, Identity). **Changes** spans both, last.
- **Below it** (a tablet, a narrow window, the pane): one column in today's order, so the pane
  needs no change but the extraction.
- **No width cap** on lists (`web/AGENTS.md`, Screen width), but the side column's facts stay
  at `max-w-prose` so a line of notes reads.
- Sections stay `DisclosureSection`s, closed at first, remembered (`rememberAs`) per place, so
  the page and the pane can remember differently.

---

## 6. Rollout

1. `components/employee-detail.tsx` from `routes/employee.tsx`, with `place`; the pane uses
   it unchanged (no visible change; e2e as is).
2. The route `employeePage` (`/employees/<id>/page`) in `ww/lib/router.ts` and `ww/app.tsx`,
   its section Employees, its ← through `back()`, with a `from` label carried in the
   navigation's state.
3. The links of §1 move to the page (all but the list's own), and ⌘K's employee results.
4. **Open page** in the pane: `actionIcons.page` and a tool in `employeeActions`.
5. The page's two columns (§5).
6. e2e: a link from an order opens the page, ← returns to the order; Open page from the pane;
   the page at 375, 1024 and 1440px in EN, LT and RU (the record row one line, nothing
   sideways).
7. Then, if it holds up: the same for catalogue items (an item's page from an order's lines
   and from Item Sets).

Docs with the change: `docs/ui-language.md` (Record page, Back link: named by where the
person came from), `docs/ux/ui-ux-guidelines.md` §2, `web/AGENTS.md` (list and detail),
`docs/ubiquitous-language.md` (the employee's page). The Help's Employees part and its
screenshots will be out of date; they are updated separately.

---

## 7. Open questions

1. **The address**: `/employees/<id>/page`, or another (§4)?
2. **Should the Employees list's names open the page on a middle-click** (a new tab) while a
   plain click opens the pane? Recommended: yes, `href` is the page, `onClick` the pane, so
   "open in new tab" gives the room the person wanted.
3. **The employee role's Employee Dashboard**: its people are the ones the user orders for;
   should its links open the page (recommended, as everywhere else) or the list?
4. **Catalogue items next** (rollout 7), or employees only?
5. **Print**: should the page print as a one-person summary (sizes, items given, assets held),
   a document of its own?
