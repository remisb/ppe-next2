# UI and UX guidelines

How the screens of the two web apps, **Workwear & Equipment** and **Administration**, are designed:
the principles, the layout and spacing of a detail pane, how a screen explains itself, status
badges, collapsible sections, moving items, and the checks a new screen passes. The rules come
from the October 2026 work on the Item Catalogue's item pane (`b6ba78d`, cleaned up in
`5a975f4`). That work set the pattern the other panes and record pages follow.

24 Oct 2026 · build `5a975f4` (live at workwear.gavort.nl)

This file is the **why and when**. Two companions hold the rest:

- [ui-language.md](../ui-language.md) is the **names**: what each region, overlay, control,
  state and pattern is called, in builder words and reader words. Use its names here and in
  code.
- [web/AGENTS.md](../../web/AGENTS.md) is the **build rules**: breakpoints, stacked tables,
  i18n mechanics, the CSP, sign-in.

If a rule here and either of those disagree, fix the one that is out of date in the same change.

---

## 1. Principles

1. **Show the record, explain on request.** A screen shows the data and its state. The
   explanation of a section, a state or a problem sits one step away: an ⓘ beside a heading,
   a status badge that opens its issues. Explanations are never paragraphs under headings, and
   never notes under badges.
2. **Flat, ruled, not boxed.** A pane is one surface. Facts sit between thin rules, and
   lists have a rule between items. There are no rounded boxes around a list or around each
   of its items.
3. **Closed by default, counted always.** A record's secondary sections (history, related
   records, Changes) start closed and show their count beside the title, so a closed section
   still says what it holds. The user's choice to keep one open is remembered.
4. **Every hover has a tap.** Anything a pointer can reveal, a finger can reveal too, except
   a hover that only repeats what the screen already says (a record preview, a list row's
   tooltip, a tab's tooltip). A help tooltip may only *add* to the screen. Help that the user
   needs is a button.
5. **A control never holds a control.** No button inside a button and no link inside a link.
   A control that sits inside something clickable becomes passive there (`InControl`).
6. **One job, one component.** Each kind of thing has one component (table in §10). A screen
   does not hand-roll a popover, a ruled list, a badge with help or a paging loop.
7. **Words come from the glossary and the dictionaries.** Every visible word is in English,
   Lithuanian and Russian, and domain words come from
   [ubiquitous-language.md](../ubiquitous-language.md). A new term is added there first.
8. **Load what is shown.** A closed section, a closed sheet or a hidden list reads nothing.
   A count is read cheaply. A run of changes is followed by one reload, not one per change.

---

## 2. The detail pane

A record opened beside a list (the item pane, the order pane, the asset pane, and Administration's
change and error panes) or on its own page below `lg`. Names are in [ui-language.md › Detail pane](../ui-language.md#detail-pane).

### Anatomy, top to bottom

| Part | What it holds | Look |
|---|---|---|
| **Header** | The record's picture or icon, its name or number (the pane's heading), and its main action and ⋯ in the corner (**Edit**, **Create confirmation link**, **Give SIM**). Below them, one muted line of details (manufacturer and model, who an order is for). | `RecordHeader` with a `RecordTitle` (`h2` `text-xl font-semibold`); `mb-4 lg:pr-10`, so the ✕ never covers it. Where both do not fit one row, the title moves under the actions |
| **Status badges** | The record's state: Active, Inactive, Incomplete (2)… Each badge with issues opens them (§5). | one row, `mb-3 flex flex-wrap gap-1` |
| **Facts** | The record's current values as label/value pairs. | `<dl>` in a grid, 2 columns (3 from the pane's `@lg`), `gap-x-6 gap-y-3`, between two rules `border-y py-3`, `mb-4`; label muted, value `font-medium tabular-nums` |
| **Other actions** | What the record allows beyond the main action, as outline buttons in one row (the order's Print Order, Mark as Signed & Given). Always above long content such as an order's lines, so a phone never scrolls to reach them. | `grid gap-2 sm:flex sm:flex-wrap` |
| **Sections** | History, related records and their counts (Price history, Orders, Item Sets, Assignments…). | `DisclosureSection`, closed at first (§4) |
| **Changes** | Who changed what, last. | `RecordChanges` |

The ✕ (Close) sits in the pane's corner beside the list. Below `lg` the pane is the whole
screen, with a back link on its own row.

### Spacing and type

One scale, so panes line up with each other:

| Use | Value |
|---|---|
| Between a list's items | `RuleList`: a rule, `py-2`, none above the first or below the last |
| A closed section to the next | `mb-1` (closed sections stack closely) |
| An open section to the next | `mb-6` |
| Under the facts | `mb-4` |
| A section's heading row | the whole row is the toggle, at least 44px tall (`min-h-11`) |
| A row's title line | `font-medium` (`text-sm` in a pane) |
| A row's detail line | `text-xs text-muted-foreground`, parts joined by " · " |
| Money, counts, dates, sizes | `tabular-nums`, so columns line up |
| A summary line over a list ("2 orders: 2 given, 0 on order.") | `text-sm text-muted-foreground mb-2` |

Do not add `rounded-lg border` around a pane's list, and do not add `p-3`/`p-4` boxes around
its items. A callout that must stand out is the one exception (a status line, the
confirmation link block). Give it rules (`border-y py-3`), not a box.

### A row in a pane's list

Two lines at most:

1. **Title line**: what the item is, and its state or amount on the right (the record number
   with its status badge, then the price; a set's name, then its quantity "× 1").
2. **Detail line**, muted and small: who, when, the size, how many, joined by " · ". A link on
   this line (the employee) keeps the text colour and underlines on hover.

A row that was a stacked card of label/value lines (seven lines for one order) becomes these
two lines. Labels go when the value says what it is ("Size 42", "× 1", a relative date).

---

## 3. Explaining things

Three tools. Pick by who needs the words and where they sit.

| Need | Use | Opens on | Example |
|---|---|---|---|
| What a section or a screen is | the `description` of `DisclosureSection`, `Panel` or `PageHeader`: an **ⓘ** beside the heading (`InfoTip`) | pointing (after 300 ms), a click, a tap, Enter. A click keeps it open until Escape or a click elsewhere. | "Orders with this item, newest activity first…" |
| What a state means, what to fix | a **status badge with issues** (`IssueBadge`, §5) | the same, on a page or pane; a tooltip inside a row | Incomplete (2), Inactive, Blocked |
| What a tab, tile or figure counts, on top of what it shows | a **help tooltip** (`HelpTooltip`) | pointing and keyboard focus only | the SIM Cards status tabs, a dashboard figure |

Rules:

- **Never a paragraph under a heading or a badge** to explain it. Use the ⓘ or the badge.
- **Touch parity.** If the words matter on a phone, use a tool that opens on a tap (the first
  two). A help tooltip never shows on touch, so it may only repeat or add to what is shown.
- **Screen readers get the same words without opening anything.** The trigger is described
  by them (`aria-describedby`). The components do this; do not add a second hidden copy. A
  `DisclosureSection`'s ⓘ reuses the section's own hidden description.
- **A fact stays in sight.** What the screen shows rather than explains (who is signed in, the
  Help guide's lede) is `PageHeader`'s `subtitle`, a line under the title, not an ⓘ.
- **The ⓘ is named "About ⟨section⟩"** (`uiText().aboutSection`), and it sits beside the
  heading, not inside it, so the heading's name stays its own.
- **Panel and tooltip look alike** (`HelpContent`): an optional title in `font-medium`, the
  body, and a note below a rule with its ⓘ. The panel is `w-72`, never wider than the screen
  less 2rem, and opens below its trigger, aligned to its start.

### Writing the words

- **A section's description** is one sentence on what the section lists and in what order,
  plus the time zone when dates are shown ("…Dates are shown in Europe/Vilnius.").
- **An issue** is two parts: **what is wrong** as a short title ending in a full stop ("Price
  is missing."), then **what to do**, naming who and where ("An authorised user must specify
  the price in Edit Item."). Name the screen or the control the user will see.
- **A note** says what the issues mean together ("Without a price and a service period this
  item cannot be ordered: Mark as Ordered refuses it.").
- One issue per missing or wrong value. Never combine two into one sentence.

---

## 4. Collapsible sections

Every secondary section of a record is a `DisclosureSection`:

- **Closed at first**, and its body mounts only when it is opened, so what the body loads is
  read then.
- **A count beside the title**, shown open or closed: what the section holds (orders, sets,
  steps). It comes from data already loaded, or from a cheap query (`page_size: 1` and its
  `total`), never by loading the whole list.
- **The whole heading row is the toggle**, with a chevron at its end that turns when open.
- **`description` gives it its ⓘ** (§3). **`action`** puts a control beside the title, outside
  the toggle (Give SIM). The order in the row is title and count, chevron, action, ⓘ.
- **Remembered per user and kind of section**, not per record:
  `rememberAs={useOpenKey('<page>.<section>')}`. Orders left open on one item is open on the
  next.
- **When opened, it shows everything**, not "the latest 100". Page through the API behind the
  scenes (`loadAllOrders`).
- `RecordChanges` is always such a section ("Changes", with its ⓘ).

---

## 5. Status badges

A badge names a state. When the state has something to fix or to know, the badge **is** the
explanation:

- **Plain badge** (`Badge`) for a state that needs no words: Ordered, Given, Active, a role,
  This device.
- **Badge with issues** (`IssueBadge`) for a state with issues or warnings: Incomplete, an
  item's or a set's Inactive, a SIM's Not Activated and Blocked, Missing (a size).

### A badge with issues

- **Its words count the issues when there are several**: `Incomplete (2)`. With one issue it
  is `Inactive`, with no number (`issueLabel`).
- **It lists every issue as a numbered row**, one issue too. A rule separates the rows, and
  the text of every row starts at the same place. Each row is the issue's title and, below it,
  what to do (§3). An optional note sits below a rule, its text in line with the rows.
- **On a page or pane it is a button**: pointing at it, a tap, a click or Enter opens the
  list, and Escape or a click elsewhere closes it. On touch screens it has a 44px tap area
  around the small badge.
- **Inside a control that takes the click itself it is a tooltip**, because a button may not
  hold a button. A table row that opens its record (`onClick`) sets this for everything in it
  (`InControl`, set by `TableRow`); in any other row the badge stays a button.
  A choice button or a button that holds a badge sets it with `<InControl value>` (the give
  sheet's card choice, the employee page's size button). On a phone, the user taps the row
  and reads the issues on the record.
- **Nothing about the state is written under the badges.** The badge holds it.
- **The variant keeps its meaning** ([ui-language.md › Badge](../ui-language.md#badge)):
  `warning` still to do, `destructive` needs action, `outline` out of use, `secondary`
  neutral, `success` done.

---

## 6. Moving items

Where people choose an order (the Item Catalogue's display order):

- **A ⠿ handle at the start of each row**, named "Move ⟨item⟩" (never "Reorder", which is a
  new order for an item due). It uses the ghost icon-button style.
- **Shown only where the order can change**: in the list's own order (no column sorted), to
  those who may change it, and never on a stacked row (a phone's row only opens its record).
- **Press and move.** The rows reorder under the pointer, and the moved row is outlined where
  it will land, so the list always shows the result. Near the window's edge the page scrolls.
- **Escape puts it back.** The up and down arrow keys on a focused handle move it one place.
- **One request, on the drop.** Nothing is sent while moving, and nothing when it lands where
  it started. Arrow-key moves are sent one after another, and the list is read again once,
  after the last.
- **A screen reader hears where it went**: "Protective gloves moved to place 1 of 4."
- **The server changes as little as it can**: only the moved item's rank when its neighbours
  leave room (spec: [catalogue-service.md](../specs/catalogue-service.md)).

Build it with `useRowDrag` (pointer events followed on the window, so a finger works and a
moved row keeps the pointer) and the pure helpers in `lib/list-order.ts`.

---

## 7. Touch, keyboard and screen readers

- **44px** for every control on touch screens: `Button` sizes `sm` and `icon-sm`
  (`pointer-coarse:`). Small things such as a badge get an invisible 44px tap area around them.
- **Every opener**: Enter or Space opens, and Escape closes and returns focus. Escape during a
  drag cancels the drag before anything else hears it (closing a pane).
- **Focus ring**: the shared button style (`buttonVariants`), and for text links
  `linkVariants`. Do not hand-write `focus-visible:` classes on a new control.
- **No second submit**: a form's Save is disabled and reads "Saving…" while it saves
  (`FormSheetActions`, `busy`).
- **Names**: an icon-only button has a name ("About Orders", "Move Safety shoes", "Close
  item"), and a heading's name is only its words.
- **Live results**: a change that moves something on screen is announced in a polite live
  region (a moved item, a copied number).

---

## 8. Loading and performance

- **Load when shown.** Sheets and forms that stay mounted load their data only while open
  (key the load on "is it open", not on the record object). A closed section loads nothing.
- **Counts are cheap.** A count for a closed section is the `total` of a one-row query.
- **Every page, at once.** When all pages are needed, read the first for the total, then the
  rest in parallel (`loadAllOrders`). One loader serves every screen.
- **One reload after a run of changes.** Queue the requests and read the list again when the
  queue is empty. Show the expected result meanwhile.
- **No per-event searches of the page.** A drag finds its rows once, when it starts.

---

## 9. Words on screen

- Three languages for every word: the app's `src/i18n` (or `uiText` in `@ppe/ui`, `auditText`
  in `@ppe/audit` for words those packages draw). A shared label lives once, in the package
  that draws it.
- Glossary casing for domain terms, sentence case for the rest
  ([ui-language.md §9](../ui-language.md#9-words-on-screen)).
- Reader words in Help and hints: "point at" (never "hover"), "tap", "drag" (only for a move
  handle).
- A count goes in brackets on a badge ("Incomplete (2)"). Beside a section's title it is a
  plain muted number ("Orders 2").

---

## 10. Components

| Job | Component | Where |
|---|---|---|
| A flat list (panes, Changes, issues) | `RuleList` | `@ppe/ui/components/rule-list` |
| A secondary section, closed at first, with a count and an ⓘ | `DisclosureSection` | `@ppe/ui/components/disclosure-section` |
| What a section is, on a tap too | `InfoTip` (drawn by `DisclosureSection`'s `description`) | `@ppe/ui/components/info-tip` |
| Help a tap opens, behind any trigger | `HelpPopover` | `@ppe/ui/components/tooltip` |
| Help on pointing only (tabs, tiles) | `HelpTooltip` | `@ppe/ui/components/tooltip` |
| The body of any help: paragraph, numbered issues, note | `HelpContent`, `HelpBody`, `HelpNote`, `helpText` | `@ppe/ui/components/tooltip` |
| Inside a clickable row or choice: help becomes a tooltip | `InControl` (set by a `TableRow` with `onClick`) | `@ppe/ui/components/tooltip` |
| A status badge with issues | `IssueBadge`, `issueLabel` | `@ppe/ui/components/issue-badge` |
| The catalogue's badges | `IncompleteBadge`, `InactiveItemBadge`, `InactiveSetBadge` | `apps/workwear/src/components/status-badges.tsx` |
| A SIM's status badge | `StatusBadge` | `apps/workwear/src/components/asset-controls.tsx` |
| A record's Changes | `RecordChanges`, `ChangeList` | `@ppe/audit` |
| Moving rows by a handle | `useRowDrag`; `moveTo`, `moveBefore`, `placeBefore`, `sameOrder` | `apps/workwear/src/lib/use-row-drag.ts`, `lib/list-order.ts` |
| Every order for a filter | `loadAllOrders` | `apps/workwear/src/lib/employee-items.ts` |
| An icon button | `buttonVariants({ variant: 'ghost', size: 'icon-sm' })` | `@ppe/ui/components/button` |
| A text link, or a button that reads as one (with its focus ring) | `linkVariants({ underline, weight, className })` | `@ppe/ui/components/link` |
| A record's header: title, main action and ⋯ in the corner, details under it | `RecordHeader`, `RecordTitle` | `@ppe/ui/components/record-header` |
| A ruled status line: an icon by tone, what it says, an action at its end (Overview's attention rows, the audit seals, Backups' verdict) | `StatusLine` (`tone`: `muted`, `success`, `warning`, `danger`) | `@ppe/ui/components/status-line` |
| An order's status, and an Ordered one's wait (an `IssueBadge` past 14 days) | `OrderStatusBadge`, `OrderWait` | `apps/workwear/src/components/order-status.tsx` |
| A form sheet's Cancel and Save, Save disabled and "Saving…" while busy | `FormSheetActions` | `@ppe/ui/components/form-sheet` |
| A record's facts, label over value (`FactGrid`, ruled), or a panel's, one per line (`layout="rows"`) | `FactGrid`, `Fact` (`wide` for a comment) | `@ppe/ui/components/facts` |
| Status tabs that filter a list (with counts and tooltips), and choices such as Language or Theme | `Segmented` (`layout`: `fill`, `fit`, `scroll`, `grid`) | `@ppe/ui/components/segmented` |
| An action with ask first, one error at a time and a busy state | `useAction` (`run(fn, { confirm, mapError })`, `fail`, `pending`), `ActionError` | `@ppe/ui/lib/use-action`, `@ppe/ui/components/states` |
| What a load shows: its error with Retry, Loading, the empty state, the content | `Loaded` (`empty`, `emptyState`); several loads as one: `combineLoads` | `@ppe/ui/components/states`, `@ppe/ui/lib/use-load` |
| Back to the list on a page or a narrow pane | `BackButton` | `@ppe/ui/components/back-button` |
| A key: in a hint line, on its own (Help), beside a control | `Kbd` (`size`: `inline`, `chip`, `tiny`) | `@ppe/ui/components/kbd` |
| Amounts and counts: a field's cents, a locked document's €, a grouped count | `euroInput`, `formatDocumentEuro`, `formatNumber` (with `formatEuro`, `parseEuro`) | `@ppe/i18n` |
| A browser and system, "Chrome on Windows" | `deviceText` | `@ppe/audit` |

---

## 11. Checklist for a new pane, section or badge

- [ ] Flat: no rounded boxes around lists or items. Lists are `RuleList`, and facts sit
      between two rules.
- [ ] Each list row is two lines at most: the title line and a muted detail line.
- [ ] Secondary sections are `DisclosureSection`s, closed at first, with a count and
      `rememberAs`. When opened, they show everything.
- [ ] Explanations are a `description` (ⓘ) or a badge's issues, never a paragraph under a
      heading or badge.
- [ ] A state with something to fix is an `IssueBadge`. Each issue says what is wrong, then
      what to do and where.
- [ ] Nothing interactive inside something interactive. Inside a row or a choice, help is a
      tooltip (`InControl`).
- [ ] Works by touch (44px, tap opens), by keyboard (Enter, Escape, arrows where things move)
      and by screen reader (names, descriptions, live result).
- [ ] Nothing loads while hidden or closed. Counts are cheap, and a run of changes reloads
      once.
- [ ] Every word is in three languages, with new terms in the glossary first.
- [ ] Tested: e2e for what a user does (opening, tapping, the words shown); unit tests for the
      pure rules. [testing.md](../testing.md) maps the rule to its tests.
- [ ] The Help guide is out of date? Say so in one line; it is updated separately.

---

## 12. Where the apps do not follow this yet

Fix these with the screen they are on. Do not copy them.

- **Administration's tab hints** (Security's devices and access review, Backups) are still
  paragraphs beside Refresh: the tabs have no heading for an ⓘ to sit beside.
- **Four lists keep their own load states**: Orders and the asset registers (an empty state with
  Clear filters), System's error list and hand-over mode (its own words). `Loaded` does not
  take an empty state's action yet.
- **The order pane's lines** are a stacked table, already ruled, not a `RuleList`. That is
  acceptable while they keep the same look.
- **List rows carry one tooltip each.** Base UI could share one tooltip per list
  (`Tooltip.createHandle`). That is not needed at today's list sizes.
