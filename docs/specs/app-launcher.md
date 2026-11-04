# App Launcher

The front door of the company's apps (ADR 0006): every app and shortcut a user's roles
open, as big tiles in groups, at `/apps/` on the staff app's origin. Phase 1 is built: a
list in code, no API of its own. Phases 2 to 5 (the registry in the API and **Manage apps**,
versions and channels served from `/apps/<slug>/`, the sandbox domain, the Trials view)
follow ADR 0006 and `docs/ux/app-launcher.md`.

Code: the package `web/packages/launcher` (`@ppe/launcher`: the list, who sees what, the
words, pinned and recent apps) and the app `web/apps/launcher` (`@ppe/launcher-app`).
Terms: `docs/ubiquitous-language.md` §13.

## The list

`APPS` in `packages/launcher/src/catalogue.ts`, in the order tiles are shown:

| Tile | Kind | Group | Opens | Seen by (any of) |
| --- | --- | --- | --- | --- |
| Workwear & Equipment | app | Workwear & PPE | `/` | every signed-in user |
| Dashboard | shortcut | Workwear & PPE | `/` | `dashboard.overview`, `dashboard.manager`, `dashboard.employee` |
| Create Order, Orders, Employees, Help | shortcuts | Workwear & PPE | their screens | every signed-in user |
| SIM Cards | shortcut | Company Assets | `/assets/sim-cards` | every signed-in user |
| Equipment | shortcut | Company Assets | `/assets/equipment` | `equipment.read` |
| Scan SIMs | app, Pilot | Company Assets | `/sim-scan/` | `assets.manage`, `sim_codes.read` |
| PPE Crew | app, Pilot, linked | People & Crew | `https://crew.167.71.68.195.sslip.io/`, a new tab | `dashboard.overview`, `dashboard.manager` (administrators and managers) |
| Administration | app | Administration | `/admin/` | `ADMINISTRATION_PERMISSIONS` |

- A tile is seen by a user who holds any of its permissions. Seeing is not doing: inside an
  app, the API's permissions decide, as before.
- A **shortcut** opens one screen inside an app. An **app** is opened by its address.
- A **linked** app (PPE Crew) is another site with its own sign-in: it opens in a new tab
  (`noopener noreferrer`), and the tile shows ↗.
- Each tile has a colour that white text passes 4.5:1 against, the same in both themes, and
  a badge for any stage but Live.
- Names come from `@ppe/launcher`'s dictionaries (EN, LT, RU), the same as each app's own;
  a product's own name (PPE Crew) is the same in every language.

## Several apps, or one

`hasSeveralApps(can)`: more than one **app** (shortcuts aside).

- **Landing.** Someone with several apps who signs in with the form at the staff app's start
  (`/`) goes to `/apps/` (`ApiProvider`'s `onSignedIn`, `apps/workwear/src/main.tsx`); the
  staff app shows *Checking your sign-in* until the page leaves. A deep link, a reload of a
  signed-in page, a sign-in in another app, and anyone with one app (the employee role,
  Equipment Assignments) stay where they are (decision D10). `/apps/` works for everyone.
- **The way back.** No app gains a row (decision D12): an **Apps** entry sits in each app's
  own menu, for users with several apps: in the staff app the phone's More panel and the
  rail's or sidebar's foot, in Administration the same places, in Scan SIMs an icon in its
  header. The staff app's ⌘K lists the other apps and App Launcher by name (group *Apps*).

## The launcher

- Sign in, the gates, Confirm your password, theme and density are `@ppe/app-shell`'s; it
  shares the staff app's sign-in, so signing in or out there does so everywhere.
- **Search** narrows the tiles by name, app or group in the language in use, ignoring case
  and Lithuanian and Russian marks; Enter opens the first. ⌘K, Ctrl+K or `/` puts the cursor
  in it.
- **Pinned** tiles first, then **Recent** apps (the last six opened), then the groups. Both
  are kept per user on the device (`localStorage` `workwear.launcher.<userId>`); an app no
  longer on the list is dropped when read. Phase 2 keeps them per user in the registry.
- From `lg`, a rail of the groups (All apps, Pinned, each group with tiles) narrows the tiles,
  as a till's categories do.
- **⋯**, or a right-click on a tile, opens a dialog (a sheet from the bottom on a phone):
  where it runs (*On this site, with your sign-in* or *Another site, with its own sign-in*),
  its stage, its address, **Open** and **Pin** / **Unpin**.
- Account (the staff app's) and Sign out: the rail's foot from `lg`, icons in the header
  below it.

## Serving

`deploy/Caddyfile` serves the build at `/apps/` (`LAUNCHER_ROOT`, default
`/srv/launcher/dist`, baked by `web/Dockerfile`) with the staff app's Content-Security-Policy;
`apps/launcher/src/csp.test.ts` keeps its inline theme script the staff app's. In
development the staff app's Vite server proxies `/apps` and `/apps/…` to the launcher's
(port 5186, `VITE_LAUNCHER_TARGET`); e2e runs it on 5187.

Requests go out as `X-PPE-App: workwear` until apps are told apart by their slug (phase 2).
