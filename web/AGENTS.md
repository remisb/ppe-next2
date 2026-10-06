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

## Languages

The staff app is in English, Lithuanian and Russian, each user's choice on Account, saved
on their account (`PUT /api/v1/users/me/language`) and so on every device; before sign-in,
the language last used on the device. Every word a user reads comes from `t` in `src/i18n`
(`t.history.title`, `t.common.days(3)`): one typed dictionary per language, split into
namespaces (`i18n/<lang>/<ns>.ts`), the Lithuanian and Russian typed against the English so
a missing key fails the typecheck. Counted phrases are functions using `plural`
(Intl.PluralRules: Lithuanian one / few / other, Russian one / few / many / other); a
sentence with a value in it is one function, never glued fragments. Never read `t` at
module level (a constant array of labels is evaluated once, in the language of the moment):
build it in the component or a function. Dates and amounts use `intlLocale()`;
`formatEuro` and `formatMonths` already do. The app remounts when the language changes.
Not translated: data (names, codes, sizes, record numbers), server error messages, and the
employee-facing confirmation page, hand-over mode and the Items Given Record, which keep
their English / Russian as the manual defines. `src/i18n/i18n.test.ts` fails when a
Lithuanian or Russian text is missing, empty or left identical to the English.
Lithuanian and Russian labels are often longer than the English, so a button
in a narrow column wraps (`h-auto min-h-11 py-2 whitespace-normal`) rather than keep the
Button's one line; the e2e *Language* step fails when a visible button's text on Create
Order is wider than the button in Lithuanian.

## Colours

The app's colours are tokens in `src/index.css`, defined once for light and once for dark
(the media query and `.dark` share the same values). The screens use the neutral shadcn
palette. Gavort's navy is the `brand` tokens (`bg-brand` and its foreground for the
button, `text-brand-mark` for the logo and the app's name, white in dark mode), used only
by the sign-in page, which sets them on the page's own background, never a panel colour
of its own. A new colour gets a token in all three places, never a literal.
The logo is `components/gavort-logo.tsx`, traced from the brand book: it takes the text
colour (navy) and in dark mode the book's gold foil, a gradient kept
in that file with the shapes because it is part of the artwork, not a screen colour.
Keep the book's clear space around it, an eighth of its width. `GavortEmblem` is its emblem alone, the
app's mark in the app bar and on the confirmation page. The favicon (`public/favicon.svg`,
navy on a light tab, gold on a dark one) and the home-screen icons (gold on navy, in
`manifest.json` and `apple-touch-icon.png`) are the same emblem; `icons/build.sh` redraws
the PNGs with `rsvg-convert`.
The theme is the device's choice on Account (and ⌘K): Light or Dark pin `<html
data-theme>`, System leaves it to the media query. `lib/theme.ts` keeps it in
localStorage, and an inline script in `index.html` applies it before the first paint;
keep the two in step. The `dark:` variant follows all three triggers.

## User guide

The Help screen (`/help`, `routes/help.tsx`) shows the user guide, which lives in
`src/help/{en,lt,ru}.ts` as typed data: sections, paragraphs, lists, shortcut tables and
screenshots, with `**names**` and `` `keys` `` marked up. A section or part carries
`roles` when only those roles can do it, and Help leaves it out for everyone else. It
carries `devices` where the screens differ: a phone (below 768px: the bar and More), a
tablet (the rail, up to 1279px) and a desktop (the sidebar, a keyboard and a mouse), so
keys, hover and "beside the list" are desktop words. Help reads the device from the
window's width, follows a resize, and shows that device's screenshots; the guide opens in
the user's language, and its switches change only the guide. Change the guide with the
screen it describes, in all three languages: `help.test.ts` fails when their sections,
parts, roles, devices or screenshots differ. `pnpm guide` in `web/e2e` retakes the
screenshots (`public/help-img/<lang>/<device>/`) from the demo data on each device and
writes `docs/guide` from the desktop guide, so never edit `docs/guide` by hand.

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
  keeps one order for the rail and sidebar. The rail and sidebar leave Create Order out
  (`md:hidden`): there it is the Create Order button on Orders, which stays the current
  section while Create Order is open, and ⌘K or G then O. From
  `md` those links flow on in the rail (`md:contents`), never a second list. An
  administrator has nine sections on a phone (Dashboard first, Users, Settings and Backups last),
  a manager or the employee role six (their Dashboard first); the rail and sidebar show one
  fewer, without Create Order. Orders shows the number of orders waiting for
  confirmation. Links take their accessible name from their text (a visually hidden full
  label), never `aria-label`, which would also match label lookups such as a field named
  "Item Set".
- **Tables** that can run wider than a phone use `<Table stack>` (or `stack="grid"` for
  two cards to a row where they fit). Below 48rem *of the table's own width* each row
  becomes a card; give every `TableCell` a `label` for its column. A table whose columns
  need more than 48rem side by side (Orders, Item Catalogue) adds `stackBelow="lg"` to
  stack below 60rem instead; measure it beside the `md` rail. Restyle cards with the
  `stacked:` variant, a screen-only container query: never `max-md:`, which also matches
  an A4 print and would print the receipt as cards. The printed Items Given Record is
  the same from a phone, a tablet or a desktop: every style that differs by breakpoint
  (`sm:`, `md:`) has a `print:` value, the print root size is fixed in `index.css`, and the
  record keeps A4's printable width on paper. Never render a list twice (a table
  for desktop plus cards for phones). Lists people scan to find a record (Orders,
  Employees, Item Catalogue, Users) use `stack="list"`: stacked, they are one bordered list
  of short rows, a title line and a facts line (a stacked row may lay its cells out on a
  `stacked:grid` so a picture or avatar spans both lines, hiding the table-only cells with
  `stacked:hidden`). A row that opens a page carries no buttons while stacked; its actions
  live on that page. `TableGroupRow` heads a group of rows (Orders' months while sorted
  by date, the Catalogue's size groups while sorted by size group). Other lists (order
  lines) keep one compact card a row rather than `stack="grid"`: from 36rem of room
  (`stacked-wide:`, a tablet in portrait) a card's actions move beside its title and its
  facts share a line.
- **Orders** is the screen the code still calls History (`routes/history.tsx`, `t.history`,
  the route `history`): it was renamed for users only, so `t.orders` never sits beside
  `t.order`. Its address is `/orders`; `/history` addresses still open it.
- **List and detail**: a row that has more to show opens it at its own address (Orders:
  `/orders/<id>`). From `lg` the detail sits beside the list; below it, it replaces the
  list, which keeps its filters and page behind it. The row's actions live in the
  detail, not in an Actions column. Beside a detail the list drops to the columns that
  find the next record (Orders: no Usage time, no time of day, the wait as the status)
  and stacks only under 30rem (`stackBelow="sm"`), so from about 1200px it stays one line
  a row; J / K step through it and Escape closes the detail.
- **Sorting**: sortable columns use `SortableHead` (`components/sortable.tsx`, `aria-sort`
  on the header) and the same state in a `SortControl` passed as the Table's
  `sortControl`, which shows only while the table is stacked and its header hidden.
  Lists loaded whole sort with `sortRows` (`lib/sort.ts`: empty values last, sizes by
  their line's size group via `sizeRank`, never by whether a size looks numeric); a paged
  list (Orders) sends `sort`/`dir` to the API.
- **Density**: Comfortable (the default) or Compact, a user's choice on Account and in
  ⌘K, saved per user on the device (`lib/density.ts`, `<html data-density>`). Style it
  with the `compact:` variant, which needs a screen with a fine pointer: Compact never
  shrinks a touch target or the printed record. `Table` already gives unstacked rows 32px
  and their buttons and ⋯ 28px (WCAG 2.5.8's 24px minimum); a stacked table keeps its
  own spacing, so `compact:` is declared before `stacked:` in `index.css`.
- **Dates in lists** are relative (`RelativeDate`: "Today 14:03", "3 days ago", "in 5
  days", then the date), in the organisation timezone, with the exact time in the
  `title`. Records, receipts and the order pane keep absolute dates.
- **Record previews**: a record number that links away from a list is a `RecordPreview`,
  which shows the order's status, lines and total on hover or focus and stays a link;
  a tap on a touch screen follows it. Not where the row already opens the order beside
  the list (Orders with an order open).
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
  (Delete, Deactivate, and Reset password on Users; Delete order in Orders' order pane,
  for the manager role only). A record with its own page (an
  employee, a catalogue item) has the same ⋯ on that page, the only place a phone reaches it. The ⋯ button is always shown, never revealed on hover: touch
  screens have no hover.
- **Empty states** give the next step in words and never repeat the header action as a
  second button with the same name.
- **Safe areas**: the viewport is `viewport-fit=cover`; bars pad with
  `env(safe-area-inset-*)`.

## Sign-in and password forms

Password managers (iCloud Keychain, Google Password Manager, 1Password, Bitwarden) must be
able to fill and save every credential form:

- Every credential field has a stable `name` and the right `autocomplete` token: sign-in
  `name="email"` / `autocomplete="username"` and `name="password"` /
  `autocomplete="current-password"`; a new password `autocomplete="new-password"`.
- A form that changes the signed-in user's password carries a hidden
  `autocomplete="username"` field with their email, so the manager updates that account.
- Sign in reads its values from the form on submit, not from React state, and its button
  is never disabled for empty fields: autofill does not always fire the events React
  listens for. Empty fields get a message instead.
- `/.well-known/change-password` redirects to `/account` (`deploy/Caddyfile`), where
  password managers send people to change a saved password.

## Sign-in state

The sign-in is an HttpOnly refresh cookie the server sets (`docs/specs/session-service.md`);
the access token lives in memory only (`lib/api.tsx`, `lib/session.ts`):

- Never store a token in localStorage, sessionStorage, IndexedDB or a readable cookie: an
  injected script could take it. The e2e step *the sign-in survives a reload…* checks.
- The app starts on "Checking your sign-in…" while `POST /auth/refresh` answers; render
  nothing that needs a session before `status` is `ready`.
- Calls go through `client`; a 401 refreshes once and repeats the call, and a 403
  `recent sign-in required` opens Confirm your password (`components/confirm-password.tsx`)
  and repeats it. Screens need no handling of their own; `errorText` words the cancelled case.
- The Vite proxy keeps the browser's `Host` header (`changeOrigin: false`): the sign-in
  routes check `Origin` against it.

## Content-Security-Policy

Caddy sends a Content-Security-Policy (`deploy/Caddyfile`): scripts, styles, fonts,
images and requests come from the app's own origin only. So:

- No script, stylesheet, font or image from another host, and no `eval` or `new Function`.
  Self-host what you need, as the Geist font is.
- The only inline script is the theme in `index.html`, allowed by its hash. Changing it,
  whitespace included, changes the hash: `src/csp.test.ts` fails and names the new value
  to put in the Caddyfile. Do not add another inline script.
- React's `style` props are fine (they go through the DOM, which `style-src` does not
  restrict); a `<style>` element or a `style` attribute written as HTML is not.
- Links to other sites (WhatsApp) are navigation and are not affected.
- The e2e suite fails on any violation when run behind Caddy (`E2E_WEB_SERVER=caddy`, as CI does).

