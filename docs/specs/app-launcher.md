# App Launcher

The front door of the company's apps (ADR 0006): every app and shortcut a user's roles
open, as big tiles in groups, at `/apps/` on the staff app's origin. Phases 1 to 3 are
built: the launcher, its list kept by the API (the registry) and managed on
Administration's **Manage apps**, and published apps' versions and channels served under
`/apps/<slug>/` (Scan SIMs first). Phases 4 and 5 (the sandbox domain, the Trials view)
follow ADR 0006 and `docs/ux/app-launcher.md`.

Code: the domain `internal/domain/launcher` (migrations 0042 and 0043, routes
`cmd/api/launcher-routes.go`; published apps `versions.go`, `service_versions.go`,
`cmd/api/published-app-routes.go` and `publish-app.go`), the package `web/packages/launcher` (`@ppe/launcher`: the
list loaded once per user and page, its rules, the words, the tile pictures, recent apps),
the app `web/apps/launcher` (`@ppe/launcher-app`) and Administration's `routes/apps.tsx`.
Terms: `docs/ubiquitous-language.md` §13.

## The registry

`launcher_apps`: one row per tile, in `position` order. The API inserts the defaults below
at start-up (`launcher.EnsureDefaults`: missing slugs only, after the rest; a tile changed
on Manage apps is never put back), and Postgres tests and e2e get them back after
emptying the database. Tiles are never deleted: **Retired** takes one away from everyone.

A tile: a **slug** (`^[a-z][a-z0-9-]{1,30}$`, set once), a **kind** (app or shortcut, set
once), a shortcut's **app** (an app on this site), names in EN, LT and RU (1–60
characters each), a **group**, an icon from a fixed list (`launcher.Icons`, `APP_ICONS`), a
colour white text passes 4.5:1 against, an **address** (a path on this site, never `//`;
an https address for a linked site; a shortcut is never linked), a **stage** (Live,
Pilot, POC, In development, Retired) and **who sees it** (any of some permissions, or
everyone signed in).

The defaults, phase 1's list:

| Tile | Kind | Group | Opens | Seen by (any of) |
| --- | --- | --- | --- | --- |
| Workwear & Equipment | app | Workwear & PPE | `/` | every signed-in user |
| Dashboard | shortcut | Workwear & PPE | `/` | `dashboard.overview`, `dashboard.manager`, `dashboard.employee` |
| Create Order, Orders, Employees, Help | shortcuts | Workwear & PPE | their screens | every signed-in user |
| SIM Cards | shortcut | Company Assets | `/assets/sim-cards` | every signed-in user |
| Equipment | shortcut | Company Assets | `/assets/equipment` | `equipment.read` |
| Scan SIMs | app, Pilot | Company Assets | `/apps/sim-scan/` | `assets.manage`, `sim_codes.read` |
| PPE Crew | app, Pilot, linked | People & Crew | `https://crew.167.71.68.195.sslip.io/`, a new tab | `dashboard.overview`, `dashboard.manager` (administrators and managers) |
| Administration | app | Administration | `/admin/` | `ADMINISTRATION_PERMISSIONS` |

- A tile is seen by a user who holds any of its permissions. Seeing is not doing: inside an
  app, the API's permissions decide, as before.
- A **shortcut** opens one screen inside an app. An **app** is opened by its address.
- A **linked** app (PPE Crew) is another site with its own sign-in: it opens in a new tab
  (`noopener noreferrer`), and the tile shows ↗.
- Each tile has a colour that white text passes 4.5:1 against, the same in both themes, and
  a badge for any stage but Live.
- A **POC** or **In development** tile is seen only by holders of **See apps in testing**
  (`apps.preview`, the built-in **Testers** role), and shown only when they turn on **Show
  apps in testing** (kept per device). A shortcut is seen only when its app is.
- `GET /api/v1/launcher` answers the signed-in user's tiles (`launcher.Visible`), their pins
  among them and `preview` (whether they hold `apps.preview`).

## Manage apps

Administration's **Manage apps** (`/admin/apps`, `/admin/apps/<slug>`; `apps.manage`,
Administrator's; in More on a phone): every tile in order, retired ones dimmed, each opened
beside the list with its facts, **Move earlier** / **Move later**, its **Feedback** (an app's)
and **Changes**. **Register app** and **Edit** open one form: kind and slug (register only;
the slug follows the English name until typed), names, app or where it runs, address,
group, stage, picture, colour (swatches or #rrggbb, refused when too light) and who sees it.

| Route | Permission | Audit event |
| --- | --- | --- |
| `GET /api/v1/apps` | `apps.manage` | |
| `POST /api/v1/apps` | `apps.manage` | `app.registered` |
| `PUT /api/v1/apps/{slug}` (replaces every field but slug and kind) | `apps.manage` | `app.changed` (how it looks, where it opens, its stage), `app.audience_changed` (who sees it); none when nothing changed |
| `POST /api/v1/apps/{slug}/move` `{before}` (`''`: last) | `apps.manage` | `app.moved` (its place before and after) |
| `GET /api/v1/apps/{slug}/feedback` | `apps.manage` | |
| `GET /api/v1/audit-events/apps/{id}` | `apps.manage` | (a tile's Changes) |
| `GET /api/v1/launcher`, `PUT /api/v1/launcher/pins` `{slugs}`, `POST /api/v1/launcher/feedback` | signed in | |

Audit events are of entity type `app`, in the Audit log's Settings area, named by the
tile's English name.

## Pins and feedback

- **Pins** are the user's (`launcher_pins`), on every device: `PUT /api/v1/launcher/pins`
  replaces them, in order, each a tile the user sees, at most 50. Phase 1's pins kept on a
  device are handed to the API once, while it has none. **Recent** apps stay per device.
- **Feedback** (`launcher_feedback`): from an app's ⋯ in the launcher, **Works well**,
  **Confusing** or **Something broke**, with what they were trying to do (at most 2000
  characters), sent with the device (by the window's width) and the language. Only on an
  app the user sees (else 404). Read on Manage apps, newest first, with who sent it.

## Apps by name in records

Each app sends its slug as `X-PPE-App` (`workwear`, `admin`, `launcher`, `sim-scan`). The API
records it as the request's source when it is one of the first three or a registered app's
slug (`launcher.Service.IsApp`, refreshed at start and on register), else `api`. The
audit trail, the security log, System's error list and Usage keep any slug-shaped source
(migration 0042). The apps name a source by `@ppe/audit`'s words, else by the app's name
from the user's launcher list (`setAppNames`), else its slug.

## Several apps, or one

`hasSeveralApps(apps)`: more than one **app** (shortcuts aside) among the user's tiles.

- **Landing.** Someone with several apps who signs in with the form at the staff app's start
  (`/`) goes to `/apps/` (`ApiProvider`'s `onSignedIn`, which asks `GET /api/v1/launcher`,
  `apps/workwear/src/main.tsx`); the staff app shows *Checking your sign-in* until it knows. A deep link, a reload of a
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
- **Pinned** tiles first (the API's), then **Recent** apps (the last six opened, per user on
  the device: `localStorage` `workwear.launcher.<userId>`), then the groups. A tile the user
  no longer sees drops out of both.
- From `lg`, a rail of the groups (All apps, Pinned, each group with tiles) narrows the tiles,
  as a till's categories do.
- **⋯**, or a right-click on a tile, opens a dialog (a sheet from the bottom on a phone):
  where it runs (*On this site, with your sign-in* or *Another site, with its own sign-in*),
  its stage, its address, **Open** and **Pin** / **Unpin**, for an app **Feedback**, and for
  a published app with more than Stable for the user, **Versions** (below).
- Account (the staff app's) and Sign out: the rail's foot from `lg`, icons in the header
  below it.

## Serving

`deploy/Caddyfile` serves the build at `/apps/` (`LAUNCHER_ROOT`, default
`/srv/launcher/dist`, baked by `web/Dockerfile`) with the staff app's Content-Security-Policy;
`apps/launcher/src/csp.test.ts` keeps its inline theme script the staff app's. In
development the staff app's Vite server proxies `/apps` and `/apps/…` to the launcher's
(port 5186, `VITE_LAUNCHER_TARGET`); e2e runs it on 5187.


## Published apps: versions and channels

Phase 3 (ADR 0006, "As built, phase 3"). An app on this site may be **published**: built with
Vite's `base: './'` and a `ppe-app.json` (`{"slug", "capabilities"}`) in its `dist/`, each
build a **version** that never changes, and **channels** that point at versions. Scan SIMs is
the first; every other app keeps its fixed address (and its tile's `href`).

- **Registry** (migration 0043): `launcher_versions` (app, version `YYYY.MM.DD-<commit>`,
  profile, capabilities, commit, published, by whom: nobody for a deploy's),
  `launcher_channels` (app, name, label for a variant, version, audience) and
  `launcher_channel_choices` (user, app, channel). Events `app.version_published`,
  `app.channel_moved` (a channel set or pointed at another version) and `app.channel_changed`
  (a variant's label or audience).
- **Channels.** `stable`, `beta`, `preview`, and **variants**: any other slug, with a label in
  EN/LT/RU. Stable is seen by whoever sees the tile; the others by holders of the permissions
  they name, or by testers (`apps.preview`) when they name none. Stable has no audience of its
  own and no label; a fixed channel has no label; a variant needs one.
- **Profiles.** The build's capabilities (`wasm`, `workers`, `camera`; any other refused) give
  its profile: none `standard` (the staff app's policy), any `device` (Scan SIMs' policy:
  WebAssembly, workers from its own files, the camera). A new capability or profile is a
  reviewed change to `launcher.Capabilities`, `cmd/api/published-app-routes.go` and
  `deploy/Caddyfile` (`TestPublishedPoliciesMatchCaddy`).
- **Addresses.** `/apps/<slug>/` opens Stable, `/apps/<slug>/<channel>/` a channel,
  `/apps/<slug>/@<version>/` one version; anything after is the app's own screen. The API
  (`GET /apps/{slug}/{rest...}`, public: the app signs in itself) answers the version's
  `index.html` with its `./` links made `/apps/files/<profile>/<slug>/<version>/…`, the meta
  tags `ppe-mount` (the address above), `ppe-files`, `ppe-version` and `ppe-channel`,
  `Cache-Control: no-cache` and the profile's policy. A retired or unknown app, an unknown
  version, and a published app with no Stable are 404; an app with no versions redirects to
  its `href` (Administration at `/apps/admin/` goes to `/admin/`). Caddy serves the files from
  the `published` volume, cached for a year, `/apps/files/standard/*` and `/apps/files/device/*`
  only. The old `/sim-scan/…` redirects (308) to `/apps/sim-scan/…`. `assets` and `files` are
  reserved slugs.
- **In the app.** `@ppe/routing`'s `basePath`, `filesBase`, `appVersion` and `appChannel` read
  the meta tags (else Vite's `BASE_URL`); `@ppe/app-shell` sends `X-PPE-App-Version`, which
  System's error list records (`error_events.app_version`). `@ppe/launcher`'s `ChannelStripe`
  shows, off Stable, the channel and version with **Back to Stable** (which also makes Stable the
  user's choice), and moves a user who does not see the channel (or, at a version's address,
  is neither a tester nor holds `apps.manage`) to Stable.
- **Publishing.** `api -publish-app <slug> -version <v> [-channel <name>] [-from-commit <sha>]`
  reads a tar of `dist/` on standard input (at most 5000 files and 300 MB; no links, nothing
  outside it), needs `API_APPS_DIR`, checks the manifest against the slug and the app (here,
  an app), puts the files in place under `.incoming` then renames them, and records the version
  (publishing it again only points the channel); the first version of an app also becomes
  Stable. A variant must be added on Manage apps before a publish names it.
  `make prod-up` publishes each app in `PUBLISHED_APPS` from the image's
  `/srv/build/<app>` to Preview; `make prod-publish APP= REF= [CHANNEL=]` builds the app at a
  git ref (`deploy/build-app.sh`, the ref's `web/Dockerfile` stage `app-dist`); `make
  publish-app APP= [CHANNEL=]` publishes a local `pnpm build` into a development
  `API_APPS_DIR`.
- **Who chooses.** `GET /api/v1/launcher` adds `channels` (by slug, the ones the user sees,
  Stable first) and `choices` (by slug; none for Stable). `PUT /api/v1/launcher/choices/{slug}`
  `{"channel"}` keeps the user's choice (one they see; `stable` or `""` removes it). The
  launcher opens a tile on the chosen channel and badges it; its **Versions** tab lists the
  channels with their versions and dates.
- **Manage apps.** An app on this site has **Versions and channels**:
  `GET /api/v1/apps/{slug}/releases` (versions newest first, channels) and
  `PUT /api/v1/apps/{slug}/channels/{name}` `{"version", "label"?, "any_of"?}`
  (`apps.manage`): each version's ⋯ has **Make Stable**, **Make Beta**, **Make Preview** and
  one per variant (promoting, or rolling back by making an older version Stable again);
  **Add variant** and a variant's **Edit** set its name (once), label, version and audience.
- **Development.** Scan SIMs' Vite server mounts it at `/apps/sim-scan/`, and the staff app's
  proxies `/apps/sim-scan` to it before the launcher's `/apps`. e2e publishes its build in
  Caddy mode (global setup, `API_APPS_DIR` a temporary folder) and drives a variant, Make
  Stable and its roll-back.
- Published builds are not backed up: they are rebuilt from git (`docs/backups.md`). Old
  versions stay until a prune command (not built).
