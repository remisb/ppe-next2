# AGENTS.md

This file — rules binding on every frontend app
Frontend apps are built with pnpm reactjs and the latest typescript ver 7. 
UI component are `ui.shadcn.com` based.


## Layout

```
web/
  AGENTS.md              this file — rules binding on every app
  package.json           workspace root, no application code
  pnpm-workspace.yaml    which directories are workspace packages
  tsconfig.base.json     strict TypeScript settings apps extend
  packages/
    api-client/          the typed client every app uses
    routing/             where an app is mounted — the base path, and nothing else
  apps/
    _template/           copy this to start an app
    <name>/              one directory per frontend
```

## Responsive layout

Mobile first: unprefixed classes are the phone layout, `sm:`/`md:`/`lg:` add to it.
The workwear app is the reference.

- **Navigation** is one `<nav aria-label="Main">` that changes shape: a bottom tab bar on
  a phone, an icon rail from `md`, a labelled sidebar from `xl`. The rail stays up to `xl`
  so a landscape tablet (1024px) keeps room for tables; the sidebar's 15rem there would
  stack them. The phone bar holds the first four sections and More, which opens a panel
  above it with the rest (Item Catalogue, Item Sets, Users), the account and Sign out.
  Create Order is the raised New order button in the middle of that bar (Draft, with the
  line count, while a draft is saved); the bar reorders with `max-md:order-*`, so the markup
  keeps one order for the rail and sidebar. From
  `md` those links flow on in the rail (`md:contents`), never a second list. An
  administrator has seven sections (Dashboard first, Users last), a manager or the employee
  role six (their Dashboard first). History shows the number of orders waiting for
  confirmation. Links take their accessible name from their text (a visually hidden full
  label), never `aria-label`, which would also match label lookups such as a field named
  "Item Set".
- **Tables** that can run wider than a phone use `<Table stack>` (or `stack="grid"` for
  two cards to a row where they fit). Below 48rem *of the table's own width* each row
  becomes a card; give every `TableCell` a `label` for its column. A table whose columns
  need more than 48rem side by side (History, Item Catalogue) adds `stackBelow="lg"` to
  stack below 60rem instead; measure it beside the `md` rail. Restyle cards with the
  `stacked:` variant, a screen-only container query: never `max-md:`, which also matches
  an A4 print and would print the receipt as cards. Never render a list twice (a table
  for desktop plus cards for phones). Lists people scan (History, Employees, Catalogue,
  order lines) keep one compact card a row rather than `stack="grid"`: from 36rem of room
  (`stacked-wide:`, a tablet in portrait) a card's actions move beside its title and its
  facts share a line.
- **List and detail**: a row that has more to show opens it at its own address (History:
  `/history/<id>`). From `lg` the detail sits beside the list; below it, it replaces the
  list, which keeps its filters and page behind it. The row's actions live in the
  detail, not in an Actions column.
- **Sorting**: sortable columns use `SortableHead` (`components/sortable.tsx`, `aria-sort`
  on the header) and the same state in a `SortControl` passed as the Table's
  `sortControl`, which shows only while the table is stacked and its header hidden.
  Lists loaded whole sort with `sortRows` (`lib/sort.ts`: empty values last, sizes by
  their line's size group via `sizeRank`, never by whether a size looks numeric); a paged
  list (History) sends `sort`/`dir` to the API.
- **Touch targets** are at least 44px. `Button` sizes `sm` and `icon-sm` grow to 44px on
  touch screens (`pointer-coarse:`); controls are `h-11`.
- **Primary actions** on long screens sit in a sticky bar above `var(--bottom-nav)`, the
  phone tab bar's height (0 from `md`). An action that cannot be undone (Mark as Ordered)
  opens a review of what it will store, confirmed there. Where a screen has room for it,
  the bar can become a sticky panel beside the content, chosen by container width: Create
  Order's summary uses `composer-wide:` (container `order`, 60rem and up).
- **Keyboard**: shortcuts live in `lib/shortcuts.ts` and never fire while typing in a
  field (⌘K / Ctrl+K excepted) or while a dialog is open. A screen's main search field
  carries `data-shortcut="search"` so `/` reaches it. Every shortcut has a visible way to do
  the same with a pointer; the ⌘K palette also opens from Search in the sidebar and More.
- **Row actions**: one visible everyday action per row or card at most (Edit Sizes,
  Edit), the rest in a `MoreActions` (⋯) menu, destructive ones last and asking first
  (Delete, Deactivate). The ⋯ button is always shown, never revealed on hover: touch
  screens have no hover.
- **Empty states** give the next step in words and never repeat the header action as a
  second button with the same name.
- **Safe areas**: the viewport is `viewport-fit=cover`; bars pad with
  `env(safe-area-inset-*)`.
