# Screen header, toolbar and More actions

A proposal for one header language across both web apps, **Workwear & Equipment** and
**Administration**: a page header that stays at the top of the screen, a toolbar with a fixed
order of controls, an optional menu button, and a screen-level **⋯ More actions** menu that
also takes what does not fit on a phone. It covers list screens, record pages and panes,
dashboards and the composer, with mockups and flows in the companion
[screen-header-toolbar.html](screen-header-toolbar.html).

28 Oct 2026 · build `368712f` · code review plus the Help screenshots (`public/help-img/en`);
no usability sessions · paths are under `web/`, `ww` = `apps/workwear/src`, `ad` =
`apps/admin/src`.

Status: **accepted (Option B) and built**, 30 Oct 2026, rollout steps 1–6. The names in §9
are in [ui-language.md](../ui-language.md). Open questions taken as recommended: the emblem
at rest is enough (1); Create Order is hidden on a phone's Orders and Employee Dashboard
(2); both primaries stay filled with a pane open (3); Clear order… is under ⋯ (4); no
Option C (5). Where the build differs from this text: Sort ▾ stands where the stacked
table's heads would be (it must show exactly while the table is stacked) rather than at the
end of the filter bar; Filters scrolls the filter bar back but moves no focus (a focused
search would open a phone's keyboard); long primaries show "+ Add" on a phone rather than
an icon alone; the stuck header is opaque.

---

## Summary

- **Nothing on a screen stays in view.** Only the phone's top bar sticks, and it shows only
  the app's name (`ww/app.tsx:285`). Scroll a list and the title, Add, Filters and the tabs are
  gone; scroll an order on a phone and its number and its main action are gone.
- **Header actions follow no order.** Twenty page headers hold six kinds of control (primary,
  outline, ghost links, Refresh, the phone's Filters, even two segmented controls on Help) in a
  different order on each screen. On a phone they wrap: SIM Cards spends two rows on Preview
  PDF, Add SIM and Filters, and its list starts halfway down the screen.
- **No screen has a ⋯.** Records do (`MoreActions`), screens do not, so rare screen actions
  (Pictures, Preview PDF, Export) are full buttons at every width and nothing can overflow.
- **Recommendation: Option B.** The page header becomes one row that **sticks** to the top;
  on a phone it slides over the app-name bar, so it costs no extra height. Its controls are a
  **toolbar** in a fixed order: Filters, Refresh, secondary buttons, an optional **menu
  button**, the primary, then **⋯**. What does not fit a width moves into ⋯, by CSS alone.
  Records get the same: their header row sticks inside the pane and on the page. Desktop tables
  keep their column heads in view. The filter bar does **not** stick; Filters and `/` bring it
  back.
- **Sort becomes a menu button** in the filter bar, replacing the "Sort by" field and its
  direction button, which take a row (two beside a pane) on stacked lists.
- **Six steps, about two weeks**, each shippable alone (§10). The Help guide will need new
  screenshots afterwards (updated separately).

---

## 1. What the screens do today

| # | Finding | Where | Effect |
|---|---|---|---|
| F1 | Only the phone's top bar is sticky, and it holds only the emblem and "Workwear & Equipment" | `ww/app.tsx:285`, `ad/app.tsx:95` | 56px of every phone screen says what the user already knows; the screen's own title and actions scroll away |
| F2 | Header actions wrap on a phone | `ww/routes/assets.tsx:293-312` | SIM Cards: Preview PDF + Add SIM on one row, Filters on a second; with the tabs, the search and Sort by, the first SIM starts at about 410 of 844px (`help-img/en/phone/assets.png`) |
| F3 | Each header orders its controls differently | Orders: Create Order, Filters · SIM Cards: Preview PDF, Add SIM, Filters · Audit log: Export, Filters, Refresh · Catalogue: Pictures, Add Item · Dashboard: two ghost links, Refresh · Help: two segmented controls | The primary sits first on one screen and last on the next; Refresh moves; the eye cannot learn where things are |
| F4 | No screen-level ⋯ | `MoreActions` is used only on records and rows | Rare screen actions (Pictures, Preview PDF, Export) are full buttons at every width; nothing can overflow on a phone |
| F5 | A record's number and main action scroll away on a phone | `ww/components/order-detail.tsx:193`, `help-img/en/phone/history.png` | Scrolled to the lines, the order shows Print Order with no number above it; Create confirmation link is off screen |
| F6 | Sort by takes a row of its own on stacked lists | `SortControl` in `@ppe/ui/components/sortable.tsx`; Employees, Catalogue, the registers | "Sort by" label, field and direction button: about 70px on a phone, two rows on Employees beside a pane |
| F7 | The filter bar's order differs | `ww/routes/employees.tsx:147` (search, then tabs) vs Orders, SIM Cards, Catalogue (tabs, then search) | The same parts in another order on each list |
| F8 | Column heads scroll away on long desktop tables, and `Table`'s `overflow-x-auto` wrapper would stop a sticky head anyway | `@ppe/ui/components/table.tsx:37` | On the Audit log or a long register, which column is which is gone after a screen of rows |
| F9 | The phone shows Create Order twice | Orders' header and the bottom bar's raised **New order** | One of them is a wasted header slot on the narrowest screen |
| F10 | Create Order's only header action is **Clear order**, an outline button that asks first | `ww/routes/create-order.tsx` | An action that empties the work sits where the main action usually is |

What is already right and stays: one primary at most per header (ui-language §2 Page header),
the record header's "main action then ⋯ in the corner" (`RecordHeader`), ⋯ always visible
and never revealed on hover, destructive items last after a separator, the sticky detail pane
from `lg`, Create Order's sticky summary bar and panel.

---

## 2. What should stick: four options

All four keep the bottom bar, the detail pane and Create Order's summary as they are.

| | Option | What sticks | Phone cost | Verdict |
|---|---|---|---|---|
| A | Today | the phone's app-name bar | 56px, no use | baseline |
| **B** | **Sticky header** | the page header (one row) on every screen; a record's header row in its pane and page; desktop column heads | **56px, the same as today**: the header slides over the app-name bar | **recommended** |
| C | Header and filter bar | B, plus the filter tabs and search | 56 + 52 + 56 ≈ 164px, a fifth of a phone | only for long logs, later, if asked |
| D | Hide on scroll down, show on scroll up | B, but moving | 0–56px | rejected |

**Why B.** It gives every screen its title and actions at any scroll position for no more
height than the bar it replaces. One row never changes height, so nothing jumps when it sticks
(a header that shrinks as it sticks changes the page's height, which moves the scroll and can
flicker on and off). The filter bar is reached in one step: **Filters** in the stuck header on a
phone, `/` on a desktop, both scrolling it into view below the header.

**Why not C.** Lists are paged at 20 (Orders) or a few dozen rows (Employees, Catalogue, the
registers), so the filter bar is rarely more than a screen away, and on a phone 164px of chrome
plus the 80px bottom bar leaves under 60% of the screen for the list. A log with heavy
filtering (the Audit log) is the one place it might pay; leave it for when someone asks.

**Why not D.** The bar moves under the finger as the user reaches for it, J / K and the
keyboard scroll do not say "up" or "down" the way a swipe does, iOS's bounce shows and hides
it at the ends, and motion that follows scrolling is what `prefers-reduced-motion` users turn
off.

---

## 3. The page header

### Anatomy (one row)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Title ⓘ                         [Filters (2)] [⟳] [Secondary] [Menu ▾] [+ Primary] [⋯] │
└──────────────────────────────────────────────────────────────────────────────────┘
  subtitle line, when there is one (scrolls away; not part of the sticky row)
```

- **Title**: the `h1`, `text-xl md:text-2xl` as now, with its ⓘ. It truncates with an
  ellipsis before any control wraps; the controls never move to a second row.
- **Toolbar**: the controls, at the end of the row (§4).
- **Subtitle** (`PageHeader`'s `subtitle`, "Signed in as …", the Help guide's lede) stays
  under the row and scrolls away with the content.
- The **description** stays an ⓘ beside the title, never a line under it.

### Sticking

- `position: sticky; top: 0` inside `main`, `z-20`, the screen's background with the same
  blur as the phone's bar. While stuck it gains a bottom rule and a light shadow; at rest it has
  neither. **Its height never changes.**
- **Stuck** is read by an `IntersectionObserver` on a 1px mark above the header
  (`data-stuck`), not by a scroll listener. CSS `scroll-state()` container queries can replace it
  when Safari and Firefox have them.
- **Phone:** the app-name bar keeps `sticky top-0 z-30`; the page header is `z-40` and opaque,
  so after the first 56px of scroll it covers the app-name bar. At rest the user sees the
  emblem, then the screen; scrolled, only the screen's own bar.
- **Tablet and desktop:** there is no app-name bar; the header sticks at the top of `main`
  and spans the list's column only, so an open detail pane keeps its own top edge, aligned to
  the header's.
- **The height is a CSS variable**, `--page-header` (56px phone, 64px from `md`), as
  `--bottom-nav` is for the bottom bar. Things that stick below it use it: column heads
  (`top: var(--page-header)`), `scroll-padding-top` on the root (so focus, `/` and Help's `#section`
  links never land under the header), Create Order's summary panel.
- **Short screens do not stick**: below 30rem of window height (a phone on its side, 200%
  zoom on a laptop) the header scrolls with the page, so the content keeps the room (WCAG 1.4.10).
- **Print**: static, and the toolbar is hidden, as the shell is now.
- **Not on**: the confirmation page, hand-over mode, documents (the Items Given Record, the
  assignment form) and sign-in. They have no toolbar.

---

## 4. The toolbar

### Slots, left to right

| Slot | Kind | Look | At most | Examples |
|---|---|---|---|---|
| 1 | **Filters** (phone only) | outline, icon + "Filters (2)"; icon + count from 375px if needed | 1 | Orders, the registers, Audit log, Security |
| 2 | **Refresh** (screens that read live figures) | `RefreshButton`: icon on a phone, icon + label from `md` | 1 | Dashboards, Overview, System, Usage, Audit log |
| 3 | **Secondary** | outline button | 2 on a desktop, 1 on a tablet, 0 on a phone | Preview PDF, Export |
| 4 | **Menu button** (optional) | outline, label + chevron | 1 | Dashboards ▾, Guide language ▾ |
| 5 | **Primary** | filled (`default`) | 1 | + Add SIM, + Add Item, + Create Order |
| 6 | **⋯ More actions** | ghost icon | 1 | the overflow and the screen's rare actions |

The primary sits at the end, next to ⋯, as it already does in every record header, so the eye
finds the main action in the same corner on a screen, a pane and a record page. ⋯ is always
last.

### Overflow, by width, without measuring

Each control says from which width it is a button (`showFrom: 'sm' | 'md' | 'lg' | 'never'`);
below that width it is an item in ⋯ instead, in the toolbar's order. Both are rendered and
CSS shows one (`hidden md:inline-flex` / `md:hidden`); the menu's items mount only while it is
open, so a screen reader never meets both. No `ResizeObserver`, nothing to recompute, the
same in print and in e2e. ⋯ itself is hidden at widths where it would be empty.

Defaults: secondary from `md`, the menu button from `sm`, the primary and Refresh always,
Filters below `md` only. The primary keeps its words on a phone (a bare "+" next to the bottom
bar's raised **New order** would mean two different things); where the header's container is
too narrow for the title and the words (Lithuanian and Russian at 375px are the test), the words
go and the icon keeps the name and a tooltip.

### What goes in a screen's ⋯

1. The overflow, in the toolbar's order (Preview PDF on a phone).
2. A separator, then the screen's **rare actions**, which are never buttons at any width:
   set-up tasks and exports used once a month (Pictures on the Item Catalogue).
3. A separator, then anything that **asks first** or empties work, last and with "…"
   (Clear order… on Create Order).

Rules: never an empty ⋯, and never one whose only item is always there (that item is a button
instead). Its name is "More actions for ⟨screen⟩" (`t.common.moreActions`, as records). No
view settings that Account and ⌘K already hold (Compact table rows, Theme).

### The optional menu button

A labelled button with a chevron that opens a **menu of one kind of choice**, for when a
choice has three or more options or would otherwise be a row of buttons:

- **Choose one of several views**: the administrator's **Dashboards ▾** (Administrator,
  Manager, Employee, the current one ticked), replacing two ghost "… Dashboard →" links; Help's
  **Guide language ▾** and **Device ▾**, replacing two segmented controls that wrap.
- **One action, several forms**: **Export ▾** if the Audit log gains a second format; today
  it is one action and stays a button.
- **Sort** in the filter bar (§5).

Not for: a single action (a button), unrelated actions (⋯), a filter that applies at once
(a filter field or tab), a state of a record (**Change Status ▾** already is one, in rows and
panes).

### Two primaries on screen

With an order open beside Orders, **Create Order** (the screen's) and **Create confirmation
link** (the pane's) are both filled. They are in two regions with two headings, so this is
allowed. Open question 3 asks whether the screen's primary should drop to outline while a
pane is open.

### Per screen

Desktop is the toolbar from `lg`; phone is below `md`. "⋯" lists what the screen's menu holds
there. Record headers are in §6.

| Screen | Today | Desktop toolbar | Phone toolbar | ⋯ holds |
|---|---|---|---|---|
| Dashboard (administrator) | Manager Dashboard →, Employee Dashboard → (ghost), Refresh | ⟳ Refresh · Dashboards ▾ | ⟳ · Dashboards ▾ | – |
| Manager Dashboard | Employee Dashboard →, Refresh | ⟳ Refresh · Dashboards ▾ (when the user has two) | ⟳ · Dashboards ▾ | – |
| Employee Dashboard | Create Order, Refresh | ⟳ Refresh · + Create Order | ⟳ (New order is the bottom bar's) | – |
| Orders | Create Order, Filters | + Create Order | Filters (n) | – |
| Create Order | Clear order | ⋯ | ⋯ | Clear order… |
| Employees | Add New Employee | + Add New Employee | + Add New Employee (icon below the fit) | – |
| SIM Cards | Preview PDF, Add SIM, Filters | Preview PDF · + Add SIM | Filters (n) · + Add SIM · ⋯ | phone: Preview PDF |
| Equipment | Add Asset, Filters | + Add Asset | Filters (n) · + Add Asset | – |
| Item Catalogue | Pictures, Add Item | + Add Item · ⋯ | + Add Item · ⋯ | Pictures |
| Item Sets | Add Item Set | + Add Item Set | + Add Item Set | – |
| Replacements due | – | – | – | – |
| Help | Guide language and Device as segmented controls | Guide language ▾ · Device ▾ | EN ▾ · Phone ▾ | – |
| Account | – | – | – | – |
| Overview, System, Usage | Refresh | ⟳ Refresh | ⟳ | – |
| Users, Roles & permissions | Add User / Add Role | + Add … | + Add … | – |
| Audit log | Export, Filters, Refresh | ⟳ Refresh · Export | Filters (n) · ⟳ · ⋯ | phone: Export |
| Security | Refresh (per tab) | ⟳ Refresh | ⟳ | – |
| Settings | – | – | – | – |

---

## 5. The filter bar

Stays where it is, under the header, and does **not** stick. One order on every list:

1. **Filter tabs** (`Segmented`), on their own row (Employees moves its tabs above the search).
2. **Search** (`data-shortcut="search"`), then the **filters**, then **Sort ▾** at the end,
   then **Clear filters** when any is set.

**Sort ▾** replaces `SortControl`'s field and direction button on stacked lists: one menu
button that says the order in words ("Name, A–Z", "Date, newest first"), whose menu has the
columns as radio items, a separator, then the two directions in words. Unstacked, the table's
sortable heads stay the way to sort, and the button is hidden, as `SortControl` is today.

On a phone, everything after the tabs and the search stays behind **Filters**. A tap on Filters
in a stuck header scrolls the filter bar back under the header, opens it and focuses its first
field. `/` on a desktop scrolls the search into view the same way (`scroll-padding-top`).

---

## 6. Records: pane and page

The same row, for a record:

```
[←]  WE-000007                         [🔗 Create confirmation link] [⋯] [✕]
     Ona Kazlauskienė · W-002            ← details line, scrolls
     Ordered  Waiting today               ← badges, scroll
```

- **The first row sticks**: inside the detail pane's own scroll on a desktop (`sticky top-0`,
  the card's background, a rule while stuck), at the top of the screen on a phone and tablet,
  where it is the page header and covers the app-name bar. Details, badges, facts and sections
  scroll under it.
- **Below `lg`** the back link moves into the row as an icon button named "Back to Orders"
  (today `PaneBar` gives it a row of its own); beside the list, ✕ stays in the corner.
- **The main action stays in the row at every width.** On a phone it shows its icon and a
  short label where the dictionary has one (`Create link`), else its icon with the full name.
  Other actions (Print Order, Mark as Signed & Given) stay as outline buttons under the facts.
- **One ⋯ per record kind**: the row's ⋯ and the header's ⋯ are built by one function
  (as `historyActions` is for orders), so they hold the same items in the same order.

---

## 7. Lists: column heads

On a desktop, an unstacked `Table` with `stickyHead` keeps its `<thead>` at `top:
var(--page-header)`. `Table` swaps its wrapper's `overflow-x-auto` for `overflow-x-clip`
where it sticks, because a scroll container would hold the head instead of the window; such
tables already stack rather than scroll sideways (`stack`). Group rows (Orders' months) do not
stick: two layers of sticky rows read as a header.

---

## 8. UX flows

Drawn step by step in the [HTML companion](screen-header-toolbar.html#flows).

1. **Phone: find a SIM and give it.** SIM Cards at rest: emblem bar, then the header row
   (SIM Cards · Filters · + Add SIM · ⋯), the tabs, the search. Scroll: the header slides over
   the emblem bar and stays. Tap **Filters (1)**: the list scrolls back under the header, the
   filters open, focus is in Location. Choose a row: the SIM's page opens with the row
   [← · +370 612 40120 · Give SIM · ⋯]. Scroll to Assignments: the row stays, so **Give SIM** is
   one tap from anywhere on the page.
2. **Desktop: work through waiting orders.** Orders, Ordered tab, an order open beside the
   list. Scroll the list: the header (Orders · + Create Order) and the column heads stay; the
   pane keeps its own row (WE-000007 · Create confirmation link · ⋯ · ✕). J / K step the pane;
   its row is the first thing that changes, so the eye stays in one place.
3. **Overflow at three widths.** SIM Cards at 1280px: Preview PDF · + Add SIM. At 768px: the
   same, the title shorter. At 375px: Filters · + Add SIM · ⋯, and ⋯ opens on **Preview PDF**.
   Nothing wraps at any width.
4. **Keyboard and screen reader.** Tab from the skip link reaches the title's ⓘ, then each
   toolbar control in order, then the filter bar. `/` focuses the search and the root's
   `scroll-padding-top` keeps it below the stuck header (WCAG 2.4.11). On ⋯, Enter opens the
   menu, the arrows move, Escape closes and returns focus to ⋯. Sticking is never announced:
   nothing changed but the scroll.
5. **Switch dashboards.** An administrator who is also a manager: **Dashboards ▾** →
   Manager (Administrator ticked). The Manager Dashboard opens with the same menu, Manager
   ticked.
6. **Sort a stacked list.** Employees on a phone: **Sort ▾** reads "Name, A–Z". Choose it:
   Name, Code, Height, Clothing, Shoes as radio items; a separator; A–Z, Z–A (the words
   follow the column: "smallest first" for a size). Choose Z–A: the menu closes, the list
   re-sorts, the button reads "Name, Z–A".

---

## 9. Words

New entries for [ui-language.md](../ui-language.md) (builder words; none goes on screen):

| Term | Brief | Reader words (EN / LT / RU) |
|---|---|---|
| **Toolbar** | the page or record header's controls in their fixed order (§4) | "the buttons at the top" / "viršuje esantys mygtukai" / «кнопки вверху» |
| **Stuck header** | the page header pinned at the top while the screen scrolls | "the bar at the top of the screen" / "ekrano viršuje esanti juosta" / «панель вверху экрана» |
| **Menu button** | a labelled button with a chevron that opens a menu of one kind of choice | its label: "choose **Dashboards**" |
| **Overflow** | toolbar controls that move into ⋯ below their width | "under ⋯" |
| **Sort ▾** | the filter bar's sort menu button | "**Sort**" (existing "Sort by" as the menu's heading) |

Changed entries: **Page header** (one row, sticky, the toolbar), **Header action** (the
toolbar's slots), **Menu** (screen ⋯, menu button), **Back link** (an icon in the record row
below `lg`), **Button kinds** (Destructive: "never a header action" becomes "never a toolbar
button").

---

## 10. Rollout

| Step | What | Effort |
|---|---|---|
| 1 | `PageHeader` one row and sticky; `--page-header`; `data-stuck`; `scroll-padding-top`; short-screen and print fallbacks; phone covers the app-name bar | M |
| 2 | `Toolbar`, `ToolbarAction` (`showFrom`), `ToolbarMenu`, `ToolbarMore`; move the 20 page headers into slot order; Pictures and Clear order… into ⋯; hide Create Order on a phone's Orders | M |
| 3 | `SortMenu` in the filter bar instead of `SortControl`'s row; Employees' tabs above its search | S |
| 4 | Record headers: the sticky row in `DetailPane` and on record pages; back as an icon below `lg`; short labels for the main actions | M |
| 5 | `Table stickyHead` on the Audit log, Orders, the registers, Users | S |
| 6 | ui-language, ui-ux-guidelines (§2, §10, §11), `web/AGENTS.md`, `docs/testing.md` | S |

Tests: an e2e step at 375, 768 and 1280px scrolls each list screen and checks that the header's
top is 0 and its primary is visible, that `/` leaves the search below the header, that Preview
PDF is in ⋯ at 375 and a button at 1280, and that no screen scrolls sideways (the existing
step). Unit tests cover the toolbar's overflow order and Sort ▾'s words.
The Help text and screenshots will be out of date after steps 1–4; they are updated
separately.

---

## 11. Open questions

1. **Brand on a phone**: is the emblem at rest, covered after 56px, enough? The alternative
   puts the screen's title in that bar from the start and the emblem only in More.
2. **Create Order on a phone's Orders** (F9): hide it there, since the bottom bar's raised
   **New order** is the same action within thumb reach?
3. **Two primaries** with a pane open: keep both filled, or drop the screen's to outline while a
   pane is open?
4. **Clear order** into ⋯ as **Clear order…**: it asks first and empties work, so ⋯ fits the
   rules; is it used often enough to stay a button?
5. **Option C for the Audit log** only, later, if people filter it while deep in the list?
