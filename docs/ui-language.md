# UI and UX language

The words for how the two web apps (the staff app **Workwear & Equipment** and
**Administration**) are put together and how they speak: the parts of a screen, the
components, the patterns people move through, the states a screen can be in, and the rules
for the words on it. Designers, developers, the Help guide and conversations about the UI
use these words, so that "open it beside the list", "a form sheet", "ask first" or "a status
line" mean one thing.

It is the companion of [ubiquitous-language.md](ubiquitous-language.md), which names the
domain (Order, Given, Assignment, Item Set…) and the labels of the domain's own controls
(**Mark as Ordered**, **Give SIM**). This file names everything around them. The binding
build rules (breakpoints, CSP, i18n mechanics) stay in [web/AGENTS.md](../web/AGENTS.md);
this file says what things are called and how they behave, and points there for how to
build them. Why and when to use each pattern, the detail pane's layout and spacing, and the
checklist for a new screen are in [ux/ui-ux-guidelines.md](ux/ui-ux-guidelines.md).

How to read an entry: **Brief**, one line; **Detail**, the rules; **Code**, the component or
file; **UI**, the words a user reads. Lithuanian and Russian are in
[Translations](#10-translations).

Rules:

1. One pattern, one name. Before adding a new kind of region, overlay or feedback, check
   this file; if it is new, add it here first.
2. Two vocabularies. **Builder words** (form sheet, detail pane, status line, stacked) are
   for code, specs and design talk. **Reader words** (the bar at the bottom, the panel on
   the right, tap, point at) are what the Help guide and on-screen hints say. An entry
   gives both where they differ. Never put a builder word on screen.
3. A glossary term keeps the glossary's casing everywhere, on screen and here; every other
   label is sentence case ([§9.2](#92-casing)).
4. [Known deviations](#12-known-deviations) lists where the apps do not follow this file
   yet. Fix them with the screen they are on, or in a change of their own; do not copy them.

---

## 1. Places

### App
- **Brief:** one of the two web apps on one origin with one sign-in: the staff app at `/`,
  Administration at `/admin/`.
- **Detail:** a link from one to the other is a full page load. Both share the shell, the
  components and the device settings (theme, density, language before sign-in).
- **UI:** Workwear & Equipment (short "Workwear"), Administration (short "Admin").

### Shell
- **Brief:** the frame around every screen: the Main navigation, the skip link, the phone's
  top header with the emblem, and the area the screen fills (`main#main`).
- **Code:** `app.tsx` in each app; `@ppe/app-shell`. **UI:** "Skip to content".

### Section
- **Brief:** one entry of the Main navigation: Dashboard, Orders, Employees, Company Assets,
  Item Catalogue, Item Sets; in Administration, Overview, Users, Audit log….
- **Detail:** a section opens one screen, or has **screens of its own** listed under it
  (Company Assets: SIM Cards, Equipment). The section stays marked as current while any of
  its screens, or a record page reached from it, is open; Orders stays current on Create
  Order.

### Screen
- **Brief:** what one address shows inside the shell, with a page header.
- **Detail:** the reader word too ("the Orders screen"). Kinds:
  - **List screen**: finds records (Orders, Employees, Item Catalogue, Users, Audit log). On
    Company Assets the list screens are **registers** (SIM Cards, Equipment), the brief's word.
  - **Record page**: one record at its own address (an employee, an asset). Reader word **page** ("the employee's page"). An order has no record page: the
    order pane is its page below `lg`.
  - **Dashboard**: key figures and panels, read-only (the three Dashboards, Overview, Usage,
    System's Status).
  - **Composer**: a screen that builds something before it is stored (Create Order).
  - **Settings screen**: cards of choices (Account, Settings).
  - **Document**: a printable A4 page with no shell actions but Back and Print (the Items
    Given Record, the assignment form).
- **Code:** `routes/*.tsx`.

### Help (user guide)
- **Brief:** the in-app guide at `/help`, limited to the reader's roles and device, with that
  device's screenshots and its own Guide language and Device switches.
- **Detail:** text in `src/help/{en,lt,ru}.ts`; `pnpm guide` regenerates the screenshots and
  `docs/guide`. Each section has its own address (`/help#history`). **UI:** Help; title
  "User guide".

### Account
- **Brief:** the signed-in user's own settings screen: Language, Theme, Change password,
  Signed-in devices, Table rows.
- **Detail:** **Language** is saved on the account; **Theme** (Light, Dark, System) and
  **Table rows** (Comfortable, Compact) are kept on this device. **UI:** Account; the
  navigation's full label "Account and password".

### Settings
- **Brief:** Administration's screen of the organisation's settings: the supplier's WhatsApp
  group and the SIM providers.
- **Detail:** not Account, and not the read-only **Settings** panel on Backups.

### Public page
- **Brief:** a page outside the sign-in and the shell: the confirmation page at
  `/confirm/<token>`.
- **Detail:** English / Russian only (**EN / RU**), the emblem instead of navigation, its
  own words (`lib/confirm-text.ts`). Hand-over mode shows the same parts on a staff device.

---

## 2. Regions of a screen

### Main navigation
- **Brief:** the one `<nav aria-label="Main">`, reshaped per device class.
- **Detail:**
  - **Bottom bar** (phone): the first sections, the raised **New order** button in the
    middle of the staff app's bar, and **More**. Reader word: "the bar at the bottom".
  - **Rail** (tablet, `md` to `xl`): icons over short labels; a section's own screens are
    short centred links under its icon (SIM Cards, Equipment), a long word hyphenated.
  - **Sidebar** (desktop, from `xl`): icons beside full labels, a section's screens listed
    under it, **Search…** at the top. In the rail and sidebar the staff app's first link is
    **New order** (a +), above Dashboard. In the staff app, Orders, Item Catalogue and Item Sets
    are listed under **Workwear** there, and Employees comes below Company Assets. A click on Workwear or Company Assets shows or
    hides its list (a chevron says which), remembered per user on the device; closed,
    Workwear shows Orders' count of orders waiting for confirmation.
  - **Foot links**: at the foot of the rail and sidebar, and in More: Help, Keyboard
    shortcuts, the other app, Account, Sign out.
- **Code:** `@ppe/ui/components/main-nav` (`navItem`, `navSubList`, `moreSubList`…).
  **UI:** short labels Home, Order, Orders, Employees, Assets, Catalogue, Sets, Keys, Account,
  Admin.

### More panel
- **Brief:** the phone's panel above the bottom bar with the sections that do not fit it,
  Search, Help, the other app, the account and Sign out.
- **Detail:** opens over a dimmed screen; a tap outside it or Escape closes it.
- **UI:** More.

### New order button
- **Brief:** the phone's raised Create Order button in the middle of the bottom bar; in the
  rail and sidebar, the first link, above Dashboard, with a +.
- **UI:** "New order"; "Draft" with the line count while a working order is kept.

### Page header
- **Brief:** a screen's title with its ⓘ and its **toolbar**, in one row that stays at the
  top of the screen while it scrolls (the **stuck header**).
- **Detail:** one row of a fixed height (56px, 64px from `md`) that never wraps: the title
  truncates first. Stuck, it gains a rule and a light shadow, never another height; on a
  phone it slides over the bar with the app's name. A **subtitle** ("Signed in as …", the
  guide's lede) sits under the row and scrolls away. It does not stick on a window under
  30rem high, nor in print. Things that stick below it (a table's column heads, Create
  Order's panel) and `scroll-padding-top` use `--header-offset`.
- **Code:** `PageHeader` (`@ppe/ui/components/page-header`, also from `states`).
  **Reader words:** "the bar at the top of the screen" / "ekrano viršuje esanti juosta" /
  «панель вверху экрана».

### Toolbar
- **Brief:** a page or record header's controls, always in one order: **Filters** (a
  phone's), **Refresh**, up to two **secondary** buttons, a **menu button**, the **primary**,
  then **⋯**.
- **Detail:** at most one primary (Create Order, Add Item, Add SIM), at the end beside ⋯ as
  in a record header. A secondary button says from which width it is a button; below it, it
  is an item in the screen's ⋯ instead (the **overflow**: Preview PDF on a phone's SIM
  Cards), by CSS, without measuring. A screen's ⋯ holds the overflow, then its **rare
  actions** (Pictures on the Item Catalogue), then what asks first, with "…" (Clear order…);
  it shows only where it holds something. A long primary keeps its icon and a shorter word on
  a phone ("+ Add"); its name stays the full one. Create Order is not in a phone's Orders
  header or Employee Dashboard: the tab bar's New order is.
- **Code:** `PageHeader`'s `filters`, `refresh`, `secondary`, `menu`, `primary`, `more`,
  `moreAsk`; `ToolbarAction` (`showFrom`, `short`, `hiddenBelow`).
  **Reader words:** "the buttons at the top" / "viršuje esantys mygtukai" / «кнопки вверху»;
  the overflow is "under ⋯".

### Back link
- **Brief:** the way from a record or document back to the list it came from, named by that
  list.
- **Detail:** below `lg` it is an icon in the record's sticky row, named "Back to Orders"; a
  record page from `lg` and a document keep the ghost button above the title. Beside a list
  the record has ✕ in the same row instead.
- **UI:** "← Employees", "← Audit log", "Item Catalogue". On a document: "← Back".

### Filter bar
- **Brief:** the controls between the header and a list that choose what it shows: filter
  tabs, the search field, filters, **Clear filters**.
- **Detail:** one order on every list: the filter tabs on their own row, then the search,
  the filters and **Clear filters**. It does not stick. On a phone, filters other than the
  tabs and the main search go behind the header's **Filters** toggle, which counts the ones
  set: "Filters (2)"; pressed in a stuck header it scrolls the filter bar back under it.
  Filters a list is opened with live in its address (`?status=ORDERED`, `?show=in-office`).

### List
- **Brief:** the table of records under the filter bar. See [§5](#5-lists).

### Detail pane
- **Brief:** a record opened from a list, shown beside the list from `lg` and in its place
  below.
- **Detail:** has its own address (`/orders/<id>`, `/assets/sim-cards/<id>`, `/catalogue/<id>`). Holds the
  record's actions; the list beside it drops to the columns that find the next record. ✕
  closes it beside the list; the back link returns from it below `lg`. Reader words: "beside
  the list" (desktop), "open it" (phone, tablet).
- **Layout:** flat. Facts sit between thin rules, and every list in it (price steps, orders,
  item sets, assignments, Changes) has a rule between consecutive items and no box around
  them or round each item (`RuleList`); an item is a title line, then its details in small
  muted text. Changes are drawn so on every record's page too (`ChangeList`).
- **Names:** the **order pane** (Orders), the **asset pane** (SIM Cards, Equipment), the
  **item pane** (Item Catalogue), the **change pane** (Audit log), the **error pane**
  (System's Errors).
- **Code:** an `<aside>`, `lg:sticky`.

### Order pane
- **Brief:** an order opened from Orders.
- **Detail:** laid out as the item pane ([Record header](#record-header)): its heading is the
  record number, with the main action and ⋯ in the corner; under it the employee, then the
  status badge (**Ordered**, or **Given** in green, done) and, while Ordered, the wait
  ("Waiting 4 days"; past 14 days a red badge that says what to do). Then its facts
  (Ordered, Prepared by, Given, Confirmed), its other actions, and only then its lines.
  Its actions by status:
  - **Ordered**: **Create confirmation link** is the main action; once pressed the link shows
    below the header and the button becomes **Confirmation link**, a disclosure with a
    chevron that hides and shows that link (Copy link, Open on this device, Share link via
    WhatsApp). Then **Print Order** and **Mark as Signed & Given**. (**Hand over now** is
    hidden for now.) No Open Employee Confirmation here: only Create Order's Send
    confirmation link opens it.
  - **Given**: **View Order** is the main action, then **Print Order**, both the Items Given
    Record.
  - Manager role: ⋯ → **Delete order…**.
  - Below the lines, the collapsible **Changes**.

### Record header
- **Brief:** a record page's title (the record's name or number, with its picture or
  avatar), its badges, and its actions: at most one primary, then ⋯.
- **Detail:** its first row (back, title, main action, ⋯, ✕) sticks: inside the pane's own
  scroll beside a list, at the top of the screen on a phone, a tablet and a record's page.
  The details line and badges scroll under it. A record's ⋯ is on its page as well as on its
  list row: on a phone the page is the only place that reaches it. The main action shows
  shorter words on a phone where it has them (Create link, View). Where the title and the
  actions still do not fit one row, the title moves under them, never the actions down.
- **Code:** `RecordHeader` (`nav`), `RecordTitle`, `ShortWords` (`@ppe/ui`).

### Facts
- **Brief:** label-and-value rows that describe a record ("Connection", "Where", "Held by"
  on an asset; Route, Answer, First seen on an error).
- **Detail:** labels are short nouns, values plain; a missing value says so in words ("No
  one", "None yet") or with an en dash "–", never blank and never "N/A".

### Section (of a page)
- **Brief:** a titled part of a record page: Items given, Assignments, Price history, Changes.
- **Detail:** a **collapsible section** is closed at first, shows its count in its title,
  explains itself in a tooltip over the title, and may have one action beside the title
  (**+ Give SIM**). It stays open or closed as the user left it, per kind of section, on this
  device. A plain section is an `h2` with its body.
- **Code:** `DisclosureSection` (`rememberAs`, `useOpenKey`), `RecordChanges collapsible`.

### Panel
- **Brief:** a titled region of a dashboard (Needs you, Spending by month, Recent backups).
- **Detail:** its title is a level-2 heading and names the region for screen readers; one
  sentence under the title says what it holds. A panel may end with a **more link**
  ("All 5 waiting in Orders →").
- **Code:** `Panel`. Reader word: "panel" only when it is the one on the right (Create
  Order's summary); otherwise its title.

### Key figures
- **Brief:** the row of tiles at the top of a dashboard; each **tile** is one headline figure.
- **Detail:** a tile is one of three kinds:
  - **report**: says the figure;
  - **link tile**: the whole tile opens the list behind the figure, and a chevron says so;
  - **filter tile**: toggles a filter on the list below it, marked while chosen, no chevron
    (the dashboards' Company Assets card).
  On a phone a tile shows one brief fact; its explanation is a help tooltip.
- **Code:** `KeyFigures`, `Kpi` (`onOpen`, `pressed`, `brief`, `help`, `alert`). **UI:**
  "Key figures"; reader word "tile".

### Card
- **Brief:** a bordered box grouping settings or facts on a settings screen or record page
  (Language, Theme, Signed-in devices).
- **Detail:** not a stacked list row (those are rows, [§5](#5-lists)) and not a panel.
- **Code:** `Card` and its parts.

### Action bar and side panel
- **Brief:** where a long screen's primary action stays in reach: a sticky **action bar**
  above the phone's bottom bar, or, where the container is wide enough, a sticky **side
  panel** beside the content.
- **Detail:** Create Order's **order summary** is both: the bar below 60rem of its container
  (`composer-wide:`), the panel from it. Reader words: "the bar at the bottom of the
  screen", "the panel on the right".
- **Code:** `var(--bottom-nav)`, container `order`.

### Pager
- **Brief:** the line under a paged list: the count, the page, **Previous** and **Next**; or,
  on a log, **Show older …**.
- **UI:** "128 orders · Page 2 of 6"; "Show older changes".

---

## 3. Overlays

Everything that opens over a screen. Reader words in brackets.

### Form sheet
- **Brief:** the modal that holds one form or one task: a bottom sheet on a phone, a centred
  dialog from `md` ("the form", or its title).
- **Detail:** a grab handle on a phone, a title, an optional description, ✕ **Close**, a
  scrolling body, a pinned **footer** with the buttons: **Cancel** on the left of the
  action, the action named as the sheet is (Add User → **Add User**; Edit Sizes → **Save**).
  A sheet that only shows something has **Close** alone. Escape closes; the page under it
  does not scroll. A **wide** sheet (`wide`) takes nearly the whole screen at a fixed height for
  a document: **PDF Preview** shows the PDF with **Open in New Tab**, **Download PDF** and **Print**.
- **Code:** `FormSheet` (`@ppe/ui/components/form-sheet`), on `<dialog>`. Not shadcn's
  `Sheet`, which slides from an edge and is not used.

### Review sheet
- **Brief:** a form sheet that shows exactly what an action that cannot be undone will
  store, with that action as its button.
- **Detail:** Create Order's **Review order** before **Mark as Ordered**. Its description
  says what becomes final ("After Mark as Ordered this record cannot be changed.").

### Steps (in a sheet)
- **Brief:** a sheet whose task has numbered steps that unlock in turn.
- **Detail:** a step done folds to one line with **Change**; reopened, **Done** folds it
  again. The footer's status line names what is left ("→ Print the form, then have it
  signed.") until it is ready ("✓ Ready: give the SIM."); until then the action looks
  dimmed (`aria-disabled`) but stays focusable, so the reason can be read. Give SIM / Give Asset: **Who and when**, **Print the
  form and have it signed**, **Hand over the SIM** (the item).
- **Code:** `components/asset-sheets.tsx`.

### Confirm question
- **Brief:** the browser's own question before an action that cannot be put back, with OK
  and Cancel ("the app asks first").
- **Detail:** worded as [§9.5](#95-confirm-questions) says. Used for Delete …, Deactivate
  item…, Mark as Signed & Given, Clear this order, replacing a working order.
- **Code:** `window.confirm`. There is no custom alert dialog.

### Confirm your password
- **Brief:** the sheet that asks for the password again before managing users, after a while
  signed in.
- **Detail:** **Continue** repeats the action; **Cancel** leaves it undone and the screen
  says "Your password was not confirmed, so nothing was changed."
- **Code:** `ConfirmPassword` (`@ppe/app-shell`).

### Menu
- **Brief:** a list of actions or choices opened from a button.
- **Detail:** the **⋯ menu** (More actions) holds a record's less common actions,
  destructive ones last after a separator; a screen's ⋯ holds its toolbar's overflow and rare
  actions (Toolbar). The **Change Status** menu lists the states as radio items and saves on
  choosing. A **menu button** opens a menu of one kind of choice. A menu may open with a
  **menu note**, words that are not an action.
- **Code:** `MoreActions`, `DropdownMenu*` (`DropdownMenuNote`, `DropdownMenuGroupLabel`,
  `variant="destructive"`).
  **UI:** ⋯, labelled "More actions for {name}"; reader word "⋯".

### Popover
- **Brief:** a panel opened from a field or button that stays tied to it: Orders' **Date**
  filter (with **Custom range…** turning it into From and To with **Apply**), a date field's
  calendar.
- **Code:** `Popover`, `PeriodFilter`, `DateInput`.

### Select list
- **Brief:** the list a select opens. Two kinds: the **native select** in forms (the
  platform's own picker), and the **app select** for a register's filters, which opens over its field, as wide and in its place, the choice ticked.
- **Code:** `Select` in `components/field.tsx`; `Select` in `components/select.tsx`.

### Tooltip and help tooltip
- **Brief:** words shown while the pointer rests on, or focus is on, a control. A **help
  tooltip** is a small card: a heading, a sentence, a note under a rule.
- **Detail:** never on touch, so it only adds to what the screen says; screen readers get the
  same words as the control's description. Explains what a tab or tile counts. Reader words:
  "point at it" (desktop only).
- **Code:** `Tooltip`, `HelpTooltip`.

### Record preview
- **Brief:** the hover card on a record number in a list or on a dashboard: the order's
  status, dates, first lines and total.
- **Detail:** stays a link; a tap on a touch screen follows it.
- **Code:** `RecordPreview`.

### Search (⌘K palette)
- **Brief:** finds record numbers, SIMs and assets by any number, employees, items and
  screens, and runs actions ("New order for …", theme, table rows).
- **Detail:** `⌘K` / `Ctrl K`, or **Search…** in the sidebar, rail or More. Results are in
  groups: Orders, Company Assets, Actions, Screens, Employees, Items.
- **Code:** `components/command-palette.tsx`. **UI:** "Search or jump to".

### Hand-over mode
- **Brief:** a full-screen view on a staff device in which the employee confirms; no shell.
- **Detail:** leaves only by **Hand back**, held 1.5 seconds, or Escape. Hidden for now.
- **Code:** `components/hand-over.tsx`.

---

## 4. Controls

### Button kinds
| Kind | Look | Use |
|---|---|---|
| **Primary** (`default`) | filled | the one main action of a header, pane, sheet or bar |
| **Outline** | bordered | a row's visible action, a second action beside the primary, a task button |
| **Ghost** | text only | back links, Clear filters, Change, more links |
| **Destructive** | red | a destructive item in a ⋯ menu; never a toolbar button |
| **Link** | underlined text | an action inside a sentence ("Copied. Open Superman Rubai Group…") |
| **Icon button** | an icon with an accessible name | ✕, ⋯, copy, Refresh on a phone, quantity steppers |

Every button is at least 44px on a touch screen (`sm` and `icon-sm` grow there). A long
Lithuanian or Russian label wraps rather than overflow.
**Code:** `Button` (`variant`, `size`).

### Menu button
- **Brief:** a labelled outline button with a chevron that opens a menu of one kind of
  choice, the current one ticked: **Dashboards ▾**, Help's **Guide language ▾** and
  **Device ▾**, a stacked list's **Sort ▾**.
- **Detail:** not for one action (a button), unrelated actions (⋯), a filter that applies at
  once (a field or tabs), or a record's state (Change Status). It says the choice or its
  name; its accessible name says both ("Device: Phone").
- **Code:** `MenuButton` (`@ppe/ui/components/page-header`). **Reader words:** its label:
  "choose **Dashboards**".

### Header action, row action, task button
- **Header action**: an action in a screen's toolbar; the primary is its main one
  ("+ Add Item").
- **Row action**: the one everyday action shown on a list row or card (Edit Sizes, Edit,
  Give SIM, Reorder); the rest under ⋯. A row that opens a page or pane shows no buttons
  while stacked: its actions are on that page.
- **Task button**: the one button on a Needs you row that does the task (Send link,
  Reorder, Add sizes, Fix).

### Tabs
- **Filter tabs**: a row of toggles above a list, each choosing a subset and showing its
  **count** (Orders: All, Ordered, Given; SIM Cards: All, the three statuses, In Office, With
  Employees, Not Returned). A help tooltip says what each counts. An empty tab may be hidden.
  Builder word "segmented tabs".
- **Section tabs**: links under a screen's header that move between its parts, each at its
  own address (Security: Sign-ins, Signed-in devices, Access review; System: Status, Errors,
  Backups). Shown only when the user may open more than one.
- **Choice tabs**: a segmented control on a settings card or Help (Theme, Language, Device).

### Chips
- **Brief:** small pill buttons in a row: Item Set buttons on Create Order (✓ when on the
  order), Help's numbered Contents, the Audit log's "Record: …" chip with ✕.

### Fields
- **Field**: a label, the control, an optional **hint** under it, and its **field error**
  in place of the hint. A required field's label ends in a red "*".
- **Search field**: a list's main search, reached with `/` on a desktop
  (`data-shortcut="search"`); its placeholder says what it matches ("Search by name or
  code").
- **Picker**: a search field that chooses one record: **Assigned to** (the employee picker,
  with **+ Add New Employee**), **Add Item** (the item picker, which adds a line; not the
  Item Catalogue's **Add Item** button, which creates a catalogue item).
- **Date field**: the language's date form, typed or from its calendar button.
- **Password field**: with a **Show password** / **Hide password** button inside.
- **Checkbox**: reader word "tick" ("tick **Keep me signed in**").
- **Radio cards**: options as bordered cards ("Where is it?" on Mark as Not Returned).
- **Quantity stepper**: a line's quantity with one-fewer / one-more buttons; ↑ / ↓ in the
  field on a desktop.
- **Code:** `Field`, `Input`, `Textarea`, `PasswordInput`, `DateInput`, `EmployeePicker`,
  `ItemPicker`, `QuantityStepper`.

### Disclosure toggle
- **Brief:** a button that shows and hides a part right below it, with a chevron: the order
  pane's **Confirmation link**, the confirmation page's **View full record**, a `<details>`
  such as "3 earlier copies" or "Stack".

### Copy button
- **Brief:** copies a number, a link or a text; its label becomes "Copied" for a moment, or
  a status line says "Copied 0712 345 678.".
- **Detail:** if the browser refuses, it says so and how to copy by hand.

### Info button
- **Brief:** the ⓘ beside a closed section's heading that holds what the section is, kept
  out of the way (every collapsible section with a description: Changes, Price history,
  Orders, Item Sets, Items given, Assignments…): pointing at it opens it, and a click, a tap
  or Enter opens it and keeps it open until Escape or a click elsewhere. Its label is "About
  <section>"; it sits beside the heading, not in it, so the heading keeps its own name.
- **Code:** `DisclosureSection`'s `description` draws it (`InfoTip`, on `HelpPopover`).

### Move handle
- **Brief:** the ⠿ grip at the start of a row whose place in a list can change (the Item
  Catalogue in its display order): press on it and move, and the rows reorder under the
  pointer, the moved row outlined where it will land; let go and the order is saved. Escape
  while moving puts it back; the up and down arrow keys on the handle move it one place.
- **Detail:** shown only where the list is in the order it changes (no column sorted), to
  those who may change it, and never on a stacked row, which only opens its record. Its
  label is "Move <name>", never "Reorder" (a new order for an item due). Pointer events, so
  a finger moves rows too.
- **Code:** `useRowDrag` (`lib/use-row-drag.ts`), `moveBefore` and `placeBefore` (`lib/list-order.ts`).

### Badge
- **Brief:** a short label for a state or a marker.
- **Status badge with issues** (`IssueBadge`): a state that has something to fix or know
  (Incomplete, an item's or a set's Inactive, a SIM's Not Activated and Blocked, Missing)
  lists it: each issue a numbered row, one issue too, what is wrong then what to do, a rule
  between rows, any note below with its ⓘ in the numbers' column, so the text of every row
  and of the note starts at the same place however many issues there are; the badge counts
  them when there are several, "Incomplete (2)". On a page or pane it is a button: pointing
  at it, a tap, a click or Enter opens the list (`HelpPopover`). Inside a control that takes
  the click itself (a table row, a choice button: `InControl`, which `TableRow` sets) it is a
  tooltip, since a button may not hold a button. Nothing about its state is written under
  the badges. A badge that only names a state (Ordered, Given, a role) stays plain.
- **Variants and meanings:**
  - `default` (filled): the final state of a record's lifecycle (Given) and the
    Administrator role;
  - `success` (green, with a tick): evidence that something was completed (Signed);
  - `warning` (amber): usable but not finished (Incomplete, whose tooltip in the list says
    what is missing);
  - `destructive`: needs action (Missing, Overdue, Not Returned, Failed, Not ready, "Not
    used for 90 days");
  - `secondary`: a state in progress or neutral (Ordered, Active, Due soon, Succeeded, a
    role);
  - `outline`: out of use, or a marker about the row (Inactive, You, This device, Built-in,
    No price).
- **Code:** `Badge`; a connection status's variant is `statusVariant` in
  `components/asset-controls.tsx`. A **count pill** is the count on a filter tab.

### Colours that mean something
- `success` / green: done. `warning` / amber: still to do. `destructive` / red: wrong or
  overdue. `whatsapp`: the WhatsApp icon on every button that copies or shares for WhatsApp.
  `brand` / Gavort navy: the sign-in page only. Always the token, never a literal colour.

---

## 5. Lists

### Table
- **Brief:** every list is a `Table`; on a wide container it is columns and rows.
- **Detail:** sortable columns have a **sortable head**; while stacked the same sort is
  **Sort ▾**, a menu button where the heads would be that says the order in words ("Date,
  newest first"; named "Sort by: …"), its menu the columns, then the two directions in the
  column's words. A long list's column heads stay in view under the stuck header on a
  desktop (`stickyHead`). A **group row** heads a group (Orders' months, the Catalogue's size
  groups); group rows do not stick.
- **Code:** `Table` (`stickyHead`), `SortableHead`, `SortMenu`, `TableGroupRow`, `sortRows`.

### Stacked
- **Brief:** a table with too little room for its columns turns each row into a stacked row
  (builder word **stacked**, the `stacked:` variant, a container query on the table's own
  width).
- **Detail:** three shapes:
  - **List rows** (`stack="list"`): one bordered list of short ruled rows, a title line and a
    facts line, for lists people scan to find a record (Orders, Employees, Item Catalogue,
    Users, the registers, the Audit log).
  - **Labelled rows** (`stack`): each cell on its own line with its column's label, ruled
    from the next row, for lists people read rather than scan (order lines, Items given,
    Recent backups).
  - **Grid** (`stack="grid"`): two to a row where they fit (the Replacement forecast).
  Thresholds: under 48rem of the table's width (`stackBelow="md"`, the default), 60rem
  (`lg`, wide lists), 30rem (`sm`, a list beside a detail pane). **Stacked-wide**
  (`stacked-wide:`, 36rem up to the threshold) lets a stacked row put its actions beside
  its title. Reader word: "the list", "a row"; never "card".
- **Rule:** one list, rendered once; never a table for desktop plus cards for phones.

### Row opens
- **Brief:** what tapping a row does, one of three:
  - **opens beside** (a detail pane: Orders, Employees, the registers, Item Catalogue, the
    Audit log, System's Errors);
  - **opens its page** (a record page: an asset from the employee page or ⌘K);
  - nothing; the row's action is its button (Replacements due).
- **Detail:** a stacked row that opens something shows a chevron. J / K step through the
  rows beside an open detail; Escape closes it.

### Density
- **Brief:** **Comfortable** (default) or **Compact** table rows, chosen per user on this
  device, with a mouse or trackpad only.
- **Detail:** Compact rows are 32px and never shrink a touch target or the printed record.
- **UI:** Account → **Table rows**; ⌘K "Compact table rows".

---

## 6. States and feedback

### Loading
- **Brief:** the screen or part is being read: "Loading…", or a skeleton in its shape.
- **Detail:** the app's first state is **Checking your sign-in…** while the sign-in is
  refreshed; nothing that needs a session draws before it.
- **Code:** `Loading`, `Skeleton`, `CheckingSignIn`.

### Empty state
- **Brief:** a dashed box where a list or panel has nothing to show, saying why and, when
  there is one, the next step in words.
- **Kinds:**
  - **Nothing yet**: "No orders yet. Orders appear here after Mark as Ordered."
  - **Nothing matches**: "No employees match “Ona”." or "No orders match these filters.",
    with **Clear filters**.
  - **All clear**: good news, not an absence: "Nothing needs you right now."
  - **Not for you**: the role cannot create here: "Only administrators can manage users."
- **Rule:** never a second button with the header action's name.
- **Code:** `EmptyState` (`Empty*` parts for the richer form).

### Error state
- **Brief:** a part could not be read: the callout **Could not load**, the reason, and
  **Retry**. The rest of the screen keeps working.
- **Detail:** a server error reads "The server could not do this. Try again; if it happens
  again, tell an administrator." with **Reference: 9f2c1a7e**. **Offline** ("The server cannot
  be reached") is the shell's own, and retries by itself when the device is back online.
- **Code:** `ErrorState`, `errorText`, `Offline`.

### Action error
- **Brief:** an action did not happen: a destructive callout whose title says what did not
  happen ("The order was not deleted", "Cannot mark as ordered") and why, with Retry when
  trying again can help.
- **Detail:** the screen's state is kept as it was before the action.

### Field error
- **Brief:** what is wrong with one field, under it, saying how to put it right: "Enter a
  name.", "Not a date. Type it as 2026-10-16."
- **Detail:** it replaces the field's hint and is announced. A form-level list of problems
  ends with what to do ("Resolve the highlighted lines.").

### Busy
- **Brief:** while an action runs, its button says so with a present participle and an
  ellipsis and cannot be pressed again: Saving…, Signing in…, Uploading…, Exporting….

### Status line
- **Brief:** one line, announced to screen readers, that says what an action did, where the
  change does not show by itself.
- **Detail:** past tense, naming the record: "SIM-000004 saved.", "SIM given to Ona
  Petraitė.", "Marked as reviewed. It is on the Audit log.", "Copied.". It may end with the
  next step as a link. There are no toasts.
- **Code:** a `role="status"` element above the list or in the sheet's footer.

### Silent success
- **Brief:** where the change shows by itself (a row's new value, a closed sheet over the
  updated list), the sheet just closes and nothing more is said.

### Result card
- **Brief:** a card that replaces a composer after its action, saying what now exists and
  offering what comes next: Create Order's "Order WE-000123 is ordered" with the link ready,
  Print Record and Start a new order.

### Next step
- **Brief:** after an action that usually leads to another, the app offers that one at once:
  Mark as Not Returned → Prepare Blocking Email; Mark as Ordered → the confirmation link;
  Reset password → **Done**.

### Callout
- **Brief:** a boxed message inside a screen: a warning or explanation (destructive or
  default), with an optional title. Announced when it appears.
- **Detail:** "Check sizes for Ona" on Create Order; "Users hold this role. Take it from
  them on Users first."; the backup verdict.
- **Code:** `Alert`.

### Unsaved changes
- **Brief:** a draft on a screen that keeps its edits until saved says so: "Changes not
  saved yet." with **Discard changes** (Settings' SIM providers).
- **Detail:** the working order is the other draft: kept on the device and shown as
  **Draft**, not as unsaved.

### Freshness
- **Brief:** a dashboard says when it was read ("Updated 14:05.") and has **Refresh**; a log
  says the timezone of its times ("Times are in Europe/Vilnius.").

---

## 7. Patterns

Named ways of moving through the apps. A new screen reuses one of these before it invents
one.

### List and detail
A list screen whose records have more to show opens a record **beside** the list from `lg`
and **in its place** below, at the record's own address; the list keeps its filters and page
behind it, its open row marked. J / K step through the list as shown and Esc closes the
record beside it. Orders, Employees, SIM Cards, Equipment, Item Catalogue, the Audit log,
System's Errors.
- **Code:** `ListDetail` (`width` `md` 26rem, `lg` 30rem for an item or an employee),
  `DetailPane`, `PaneBar` (Back below `lg`, Close in the corner beside), `useListKeys`
  (`@ppe/ui`).

### Edit in a sheet, edit in place
A record's fields are edited in a **form sheet** from its row or header (Edit Item, Edit
Sizes from the list). A small part of a record page is edited **in place**: the card's
**Edit** turns its values into fields with Cancel and Save, Escape cancels (the employee
page's Sizes and Preferred language). A missing value is a "Missing" badge that opens its
field.

### Review first
An action that creates something that can never be changed shows a **review sheet** of what
it will store, and only that sheet carries the action. Mark as Ordered.

### Check a batch first
Many records added at once from what a reader took (a camera, photos) are a **review list**
first: one row per record, every field editable, each marked as the API would refuse it
(problems, which keep the action dimmed with how many need fixing) or worth knowing (notes,
which do not), checked against the server as the list changes. Its one action adds them all
or none, and names a refused row. Scan SIMs.

### Ask first
An action that deletes, ends, or locks something, or takes it out of other people's work,
asks a **confirm question** first: Delete …, Deactivate item…, Mark as Signed & Given, Clear
this order. A change that can be set back the same way it was made (Change Status, Activate
item, Sign out a device, Remove the group) does not ask. A destructive action is never a
row's visible action: it is the last item of ⋯.

### Gated steps
A task with conditions the law or the brief requires (the printed and signed assignment
form) is **steps in a sheet**; the action stays dimmed, with the reason, until each step is
done. Give SIM, Give Asset.

### Offer the next step
After an action, offer the one that usually follows it (see [Next step](#next-step)) rather
than leaving the user to find it.

### Print in place
**Print …** prints the document from the screen, without opening a tab; **View …** opens it
on screen; **Download PDF** saves the same document as a file. Printed documents look the
same from any device.

### Hand to the employee
What the employee reads (the confirmation page, hand-over mode, the Items Given Record)
speaks English / Russian with its own words, shows the employee's items, prices and total,
and asks for one thing: **Confirm receipt**.

### Remembered on this device
The device keeps the user's way of looking, never data: theme, table rows, collapsible
sections open or closed, the working order, the language before sign-in. The account keeps
the language.

### Keyboard layer
Every shortcut has a pointer way to do the same; none fires while typing in a field (⌘K
excepted) or while a sheet is open. `/` search, `G` then a letter, `J`/`K`, Escape, `⌘/Ctrl
Enter`, `?`. **Code:** `lib/shortcuts.ts`. Reader words: "press" with the keys in code style.

### Permission decides
A screen shows a control only when `session.can(...)` allows it; it never says what the user
cannot do, except an empty state of kind **Not for you** where the screen would otherwise be
blank.

---

## 8. Devices and layout

### Device classes
- **Brief:** **phone** (below 768px), **tablet** (768–1279px), **desktop** (1280px and
  wider), read from the window's width.
- **Detail:** breakpoints `md` (48rem) from tablet, `lg` (64rem) list and detail side by
  side, `xl` (80rem) the sidebar. No screen scrolls sideways at 375, 768, 920, 1100 or
  1280px. Touch targets at least 44px.
- **Reader words:** a phone has "the bar at the bottom" and "More"; a tablet "the rail"; a
  desktop "the sidebar", keys, pointing and "beside the list". Help says each device's words
  only to that device.

### Container terms
- **Stacked**, **stacked-wide**: a table's own width ([§5](#stacked)).
- **Composer-wide**: Create Order's container from 60rem, where the summary becomes a side
  panel.
- **Compact**: Compact density on a fine pointer.
- **Code:** the custom variants in `@ppe/ui/styles.css`; use them, never `max-md:` for a
  table (it would match an A4 print).

### Safe area
The phone's bars pad with the device's safe-area insets; `--bottom-nav` is the bottom bar's
height (0 from `md`), which sticky bars sit above.

---

## 9. Words on screen

### 9.1 Voice
- Plain, short, present tense. Say what something is or does, and what comes next.
- Address the reader as "you" ("Nothing needs you right now."). Name people by name ("SIM
  given to Ona Petraitė."), never "the user".
- No exclamation marks, no "Oops", no "Successfully", no "Are you sure?". "Please" only on
  the confirmation page, which the employee reads.
- Say the consequence, not the mechanism: "Their past orders are kept.", not "This performs
  a soft delete."
- One word for one thing, the glossary's ([Words to avoid](ubiquitous-language.md#words-to-avoid)
  there, [§11](#11-words-to-avoid) here).

### 9.2 Casing
- **A glossary term keeps the glossary's casing**: screen names (Create Order, Item
  Catalogue, SIM Cards, Audit log, Roles & permissions, Replacements due), named actions
  (Mark as Ordered, Give SIM, Return, Change Status, Edit Sizes, Add Item,
  Upload Signed Form, Copy for WhatsApp), states (Ordered, Given, Not Activated, In Office,
  With Employees, Not Returned, Signed Copy Missing) and named fields (Inventory No., Given
  Date, Held By).
- **Everything else is sentence case**: everyday buttons (Edit details, Clear filters, Copy
  link, Send link, Sign out, Start a new order), headings of panels and sections (Needs you,
  Items given, Price history), tabs and options that are not a state (Missing a size, Due
  soon, Any location), messages.
- **In a sentence**, a control or screen keeps its casing and the Help guide sets it in
  bold; a state used as an ordinary word is lower case ("marked as not returned", "is back in
  the office").
- A new named action or state goes into the glossary first, and is Title Case from then on.

### 9.3 Labels
- A button is a verb and its object: **Delete order…**, **Print Form**. A button alone in
  its context may be the verb alone: **Save**, **Edit**, **Retry**.
- The same action has the same label wherever it is. The verbs:

| Verb | Means |
|---|---|
| **Add …** | create a record (Add Item, Add SIM, Add Asset, Add User, Add Role, Add New Employee) |
| **New order** | start a working order, which is not a record until Mark as Ordered |
| **Edit**, **Edit …** | change a record's fields |
| **Save** | keep a form's changes; name the thing only when two Saves share a screen |
| **Cancel** | leave a form or question, changing nothing |
| **Close** | dismiss what only shows something |
| **Done** | finish a step whose work is already kept |
| **Back**, **← {list}** | return to where the user came from |
| **Delete …** | remove a record from the app (a soft delete); asks first |
| **Remove …** | take a part out of what is being edited (Remove line, Remove the group) |
| **Deactivate …**, **Activate …** | take out of, or put back into, everyday use |
| **Mark as …** | record a fact staff saw (Mark as Ordered, Mark as Signed & Given, Mark as Not Returned, Mark as reviewed) |
| **Return** | close an assignment: the asset is physically back (one word for a SIM and an item; its help tooltip says what it does) |
| **Give …** | open an assignment (Give SIM, Give Asset) |
| **Change …** | choose another of a fixed set of states (Change Status) |
| **Print …**, **View …**, **Preview …**, **Download PDF** | the document printed, on screen, shown before it is final, as a file |
| **Upload …** | add a file (Upload Signed Form) |
| **Copy …**, **Share … via WhatsApp** | to the clipboard; through WhatsApp |
| **Prepare …** | make a text the user sends themself, from its mail template; nothing is sent (Prepare Activation Email, Prepare Blocking Email) |
| **Send Email** | open the user's own mail app with the prepared email filled in (`mailto:`); they send it there |
| **Create confirmation link**, **Send link** | make the link; offer the ways to give it |
| **Open …**, **… →** | go to another screen or app |
| **Apply** | make a popover's choice the filter |
| **Clear filters**, **Clear order** | set every filter back; empty the order in progress (asks first) |
| **Refresh** | read the screen's data again |
| **Retry** | repeat what failed |
| **Show older …**, **Previous**, **Next** | page through a list |
| **Reorder** | a new order from an item due for replacement |
| **Sign in**, **Sign out** | (never log in, log out) |

### 9.4 Punctuation and symbols
- **Ellipsis "…"** (one character) ends:
  - a menu item that asks first or needs another choice: **Delete order…**, **Deactivate
    item…**, **Reset password…**, **Custom range…**;
  - a busy label: **Saving…**;
  - a placeholder that invites typing: "Search employees…".
  Not a button that opens a sheet of its own name (Give SIM, Edit Sizes, Add Item): the sheet
  is the next step and nothing happens until its own button.
- **"+"** starts a header action that adds (+ Add Item, + New order) as an icon, not a typed
  character, except in a picker's option (**+ Add New Employee**).
- **"→"** ends a link that leaves for another screen ("Manager Dashboard →", "Open Item
  Sets →"); **"←"** starts a back link.
- **"·"** separates facts on one line ("3 lines · €274.90", "J / K next or previous order ·
  Esc close").
- **"⋯"** is the More actions button only.
- **Quotation marks** are the language's: “Ona” (EN), „Ona“ (LT), «Ona» (RU), around what
  the user typed or named.
- **En dash "–"** for a range ("44–46", "2026.09.01 – 2026.09.30") and for "none" in a cell
  (a size: `formatSize`).
- Messages and hints end with a full stop; labels, titles, tabs and badges do not.

### 9.5 Confirm questions
"Verb the thing? What follows." In one or two short sentences, naming the record:
- "Delete Ona Petraitė? Their past orders are kept."
- "Deactivate Safety boots? It will no longer be offered in Add Item. Orders that hold it keep it."
- "Record that Ona Petraitė signed the paper record for WE-000123? The order becomes Given."
Say what cannot be undone ("This cannot be undone in the app."). OK is the browser's.

### 9.6 Messages
- **Status line**: past tense, the record first ("SIM-000004 saved.").
- **Action error title**: what did not happen ("The order was not deleted"); the reason
  below; the server's own words never.
- **Field error**: an instruction ("Enter a valid email address, like name@example.com.").
- **Hint**: what the choice changes ("Affects future orders only.").
- **Empty state**: why it is empty, then the next step in words.
- **Tooltip**: what it counts or does, then any note ("The figures overlap: a card not
  returned is also with an employee.").

### 9.7 Numbers, dates and money
- Counts are counted phrases, never "item(s)": "1 line", "3 lines", in each language's
  plural forms.
- Money in the language's form: "€274.90" / "274,90 €"; the purchase price is never shown
  beside an order.
- One date form per language (2026-10-15, 2026.10.15, 15.10.2026); lists use relative dates
  ("today 14:03", "3 days ago") with the exact time in a tooltip; records, receipts and the
  order pane keep absolute dates; printed documents write "2026 10 15".
- All times in the organisation timezone, said where times are listed.

### 9.8 Interaction verbs (reader words)
| Doing | English | Lietuvių | Русский |
|---|---|---|---|
| a finger on a touch screen | tap | palieskite | нажмите / коснитесь |
| a mouse button | click | spustelėkite | нажмите |
| a key | press `Esc` | paspauskite | нажмите |
| an option, menu item or button, any device | choose | pasirinkite | выберите |
| resting the pointer (desktop only) | point at | užvedę žymeklį | наведите указатель |
| a checkbox | tick | pažymėkite | отметьте |
| into a field | type, enter | įveskite | введите |
| a row by its move handle | drag | vilkite | перетащите |

Never "hover" (a builder word), "select" (except selecting text to copy) or "swipe": nothing
in the apps needs them. "Drag" is only for a move handle.

---

## 10. Translations

The dictionaries (`web/apps/*/src/i18n`, `@ppe/ui`'s `text.ts`, `@ppe/app-shell`'s
`text.ts`) are the source; this table follows them. Domain labels are in the
[glossary's Translations](ubiquitous-language.md#translations).

| English | Lietuvių | Русский |
|---|---|---|
| Save / Saving… | Išsaugoti / Saugoma… | Сохранить / Сохранение… |
| Cancel / Close | Atšaukti / Uždaryti | Отмена / Закрыть |
| Edit / Add / Back | Redaguoti / Pridėti / Atgal | Изменить / Добавить / Назад |
| Search / Search… | Paieška / Ieškoti… | Поиск / Поиск… |
| More (phone) | Daugiau | Ещё |
| More actions for {name} | Daugiau veiksmų: {name} | Другие действия: {name} |
| Filters / Clear filters | Filtrai / Išvalyti filtrus | Фильтры / Сбросить фильтры |
| Sort by | Rikiuoti pagal | Сортировать по |
| All / None / Total | Visi / Nėra / Iš viso | Все / Нет / Итого |
| Previous / Next | Ankstesnis / Kitas | Предыдущая / Следующая |
| Copied | Nukopijuota | Скопировано |
| Loading… | Įkeliama… | Загрузка… |
| Could not load / Retry | Nepavyko įkelti / Bandyti dar kartą | Не удалось загрузить / Повторить |
| Reference: … | Nuoroda į užklausą: … | Номер запроса: … |
| Refresh | Atnaujinti | Обновить |
| Key figures / Needs attention | Pagrindiniai rodikliai / Reikia dėmesio | Основные показатели / Требует внимания |
| Show password / Hide password | Rodyti slaptažodį / Slėpti slaptažodį | Показать пароль / Скрыть пароль |
| Sign out | Atsijungti | Выйти |
| New order / Draft | Užsakyti / Juodraštis | Новый заказ / Черновик |
| the bar at the bottom | ekrano apačios juosta | панель внизу |
| the sidebar | šoninė juosta | боковая панель |
| the panel on the right | dešinėje esantis skydelis | панель справа |
| beside the list | šalia sąrašo | рядом со списком |
| tab / tile | skirtukas / plytelė | вкладка / плитка |
| field / button / menu | laukas / mygtukas / meniu | поле / кнопка / меню |

---

## 11. Words to avoid

| Avoid | Say instead | Why |
|---|---|---|
| modal, popup, dialog, drawer (on screen or in Help) | the sheet's title, or "the form" | Readers see a titled form; "dialog" is a builder word for `<dialog>`. |
| Sheet (shadcn's), side sheet, drawer (in code) | **form sheet** | The app has one modal and it is not an edge-anchored sheet. |
| toast, snackbar, notification (for feedback) | **status line** | There are none; feedback stays on the screen it belongs to. |
| alert, alert dialog (for a question) | **confirm question** | `Alert` is the callout component; questions are the browser's. |
| card (for a stacked list row) | **row** | Lists stack into ruled rows; a card is a settings or facts box. |
| page (for a list screen or dashboard) | **screen**; **page** for a record page, the confirmation page, Help's sections | |
| side panel, drawer, inspector (for a record beside a list) | **detail pane** (order pane, asset pane…); reader words "beside the list" | |
| popup menu, kebab, overflow menu | **⋯ menu**, More actions | |
| hover, mouse over (in Help) | **point at** | Hover is not there on touch. |
| select, pick (as an instruction) | **choose** | "Select" is for text. |
| submit, OK, Yes / No (as a label) | the action's own name | A button says what it does. |
| Are you sure?, Warning:, Error: | the consequence ("Their past orders are kept.") | |
| Successfully …, Oops, Something went wrong (as a title) | what happened ("SIM-000004 saved."), what did not ("The order was not deleted") | "Something went wrong." is only the last fallback of `errorText`. |
| N/A, null, empty, blank | **None**, **No one**, "–" | |
| Try again (as a button) | **Retry**; "try again" in a sentence | One label on every error. |
| disabled (to a reader) | say why it cannot be done yet ("→ Print the form, then have it signed.") | |
| History, Log (for a record's changes) | **Changes**; **Audit log** | The glossary's rule. |

---

## 12. Known deviations

Where the apps do not follow this file. None are known: the ones found on 2026-10-19 are
fixed. Add a row here (where, now, should be) when one is found and not fixed at once.
