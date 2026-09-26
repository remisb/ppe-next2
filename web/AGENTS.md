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
  a phone, an icon rail from `md`, a labelled sidebar from `lg`. Links take their
  accessible name from their text (a visually hidden full label), never `aria-label`,
  which would also match label lookups such as a field named "Item Set".
- **Tables** that can run wider than a phone use `<Table stack>` (or `stack="grid"` for
  two cards to a row where they fit). Below 48rem *of the table's own width* each row
  becomes a card; give every `TableCell` a `label` for its column. A table whose columns
  need more than 48rem side by side (History, Item Catalogue) adds `stackBelow="lg"` to
  stack below 60rem instead; measure it beside the `md` rail. Restyle cards with the
  `stacked:` variant, a screen-only container query: never `max-md:`, which also matches
  an A4 print and would print the receipt as cards. Never render a list twice (a table
  for desktop plus cards for phones).
- **Sorting**: sortable columns use `SortableHead` (`components/sortable.tsx`, `aria-sort`
  on the header) and the same state in a `SortControl` passed as the Table's
  `sortControl`, which shows only while the table is stacked and its header hidden.
  Lists loaded whole sort with `sortRows` (`lib/sort.ts`: empty values last, sizes by
  vocabulary via `rankIn`); a paged list (History) sends `sort`/`dir` to the API.
- **Touch targets** are at least 44px. `Button` sizes `sm` and `icon-sm` grow to 44px on
  touch screens (`pointer-coarse:`); controls are `h-11`.
- **Primary actions** on long screens sit in a sticky bar above `var(--bottom-nav)`, the
  phone tab bar's height (0 from `md`).
- **Empty states** give the next step in words and never repeat the header action as a
  second button with the same name.
- **Safe areas**: the viewport is `viewport-fit=cover`; bars pad with
  `env(safe-area-inset-*)`.
