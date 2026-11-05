# App Launcher handbook

How App Launcher works today, how people use it, how an app joins it, how new
apps should be designed, and what should change next. For everyone who uses the
apps, administers them or builds them.

As of 2026-11-05: production `b276a0a`; improvements 1–9 built on main since; a second review proposes 10–23. Decisions: [ADR 0006](../architecture/adr/0006-app-launcher.md).
Rules and routes: [the spec](../specs/app-launcher.md). The research and options
that led here: [the decision guide](app-launcher.md). Terms: glossary §13.

---

## 1. In one paragraph

App Launcher is the front door of the company's apps, at `/apps/` on the staff
app's site. Each person sees only the apps and shortcuts their roles open, as big
tiles in groups. They sign in once for all of them. Administrators register new apps
and shortcuts on **Manage apps** without touching DNS, servers or the web server's
config. An app built in this repository can be **published** in versions, so a few
testers try a new build while everyone else keeps the one that works, and a bad
build is rolled back in one click.

## 2. What it gives us

| For | Benefit | How |
|---|---|---|
| Staff | Less to remember | One address, one sign-in, only their own apps (by permission), pins and recent apps |
| Staff | No dead ends | Every app has an **Apps** entry back; someone with one app never sees the launcher |
| Administrators | A new app or tile in minutes | **Register app** on Manage apps: name, picture, colour, group, stage, who sees it |
| Administrators | Safe trials | POC and In development show only to **Testers**; Beta, Preview and variants only to who you choose |
| Administrators | Undo | **Make Stable** on an older version rolls back at once; every change is in the Audit log |
| Product owners | Evidence | **Feedback** on every app tile; errors carry the app and its version |
| Developers | No infrastructure per app | One registry, one route, one Caddy rule for all published apps; a build is a folder and a JSON file |
| Security | Clear trust boundary | Only code reviewed in this repository runs on the site, with the user's sign-in; outside code is a linked site (later, a sandbox domain) |

## 3. For staff: using the launcher

**Getting there.** If your roles open more than one app, you land on **Apps** when
you sign in at the start page. To come back: **Apps** in **More** on a phone, at the
foot of the rail on a tablet, at the foot of the sidebar on a desktop, the grid icon
in Scan SIMs, or `⌘K` → *App Launcher* in the staff app. Someone with only one app
(the employee role, Equipment Assignments) goes straight to it and never sees the launcher.

**Finding an app.** Tiles are grouped: *Workwear & PPE*, *Company Assets*, *People &
Crew*, *Administration*. **Search apps and screens** narrows by name or group, in your
language, ignoring case and Lithuanian or Russian marks; `Enter` opens the first. On a
desktop, `⌘K` or `/` jumps to the search, and the rail shows one group at a time.

**Reading a tile.**

| You see | It means |
|---|---|
| Plain tile | An app or one of its screens (a *shortcut*), opens here |
| ↗ in the corner | Another site with its own sign-in (PPE Crew), opens in a new tab |
| **Pilot**, **POC**, **In development** | How far along the app is |
| An amber badge, such as **Beta** | You chose another version of this app (see below) |

**Pins and recent apps.** **⋯** on a tile → **Pin** keeps it first, under **Pinned**,
on every device you use. **Recent** shows the last six apps you opened on this device.

**Feedback.** **⋯** → **Feedback** → *Works well*, *Confusing* or *Something broke*,
plus a sentence on what you were trying to do. The app's owner reads it on Manage apps.

**Testers.** With the **Testers** role, turn on **Show apps in testing** to see POC and
In development apps. When an app has versions you may try, its **⋯** shows **Versions**:
pick **Beta**, **Preview** or a named variant and the app opens on it for you from then
on, even from a bookmark or another app's link. Inside the app an amber stripe says
*You are using Beta · Version 2026.11.05-…*, with a switch between your channels and
**Back to Stable**.

## 4. For administrators: Manage apps

Administration → **Manage apps** (`apps.manage`, the Administrator role).

**Register a tile.** **Register app**: names in EN/LT/RU, a slug set once (`size-helper`),
*App* or *Shortcut* (one screen of an app), group, stage, picture, colour (white text must
pass 4.5:1), and where it runs: *On this site* with a path, or *Another site* with an
https address.

**Who sees it.** *Everyone signed in*, or holders of any ticked permission. Seeing a
tile grants nothing: the API still checks every action. **POC** and **In development**
are for Testers only; **Retired** hides the tile from everyone and keeps its history
(tiles are never deleted).

**Order, feedback, history.** **Move earlier / later**; **Feedback**, newest first;
**Changes** lists every edit with who made it.

**Versions and channels** (published apps, today Scan SIMs):

| Channel | Who sees it | Moves when |
|---|---|---|
| **Stable** | Everyone who sees the tile | You choose **Make Stable** (the first publish sets it once), or every deploy while **Stable follows deploys** is on |
| **Beta** | Testers, or the permissions you name | You choose **Make Beta** |
| **Preview** | Testers, or the permissions you name | Every deploy publishes the deployed build here |
| *Variant* (e.g. `photos-first`) | The permissions you name, else Testers | **Add variant** / **Make …** |

Recipes:

1. **Ship a new build to everyone.** Deploy (it lands on Preview). Try it yourself
   (`/apps/sim-scan/preview/`), then ⋯ beside the version → **Make Stable**. A note
   says when Preview is ahead of Stable. For an app no one tries first, turn on
   **Stable follows deploys** and every deploy reaches everyone.
2. **Let a few people try it first.** **Make Beta** on the new version; give those people
   the Testers role, or name a permission on the channel. They choose Beta under
   **Versions** in the launcher.
3. **Roll back.** ⋯ beside the previous version → **Make Stable**. Instant; nothing is rebuilt.
4. **Compare two designs.** Publish both, **Add variant** for the second with a label
   (*Photos first*) and an audience; compare feedback.

## 5. How it works (technical)

```
 Browser ── https://workwear.gavort.nl ──► Caddy
   /                    staff app (baked into the Caddy image)
   /admin/              Administration (baked)
   /apps/  /apps/assets/*   App Launcher (baked)
   /apps/files/<profile>/<slug>/<version>/*   published files ◄── volume "published" (read only)
   /apps/<slug>/...     ──► Go API: index.html of the right version, links rewritten, CSP by profile
   /api/*               ──► Go API: registry, pins, choices, feedback, everything else
```

**Registry** (`internal/domain/launcher`, migrations 0042–0045):

| Table | Holds |
|---|---|
| `launcher_apps` | Tiles: slug, kind, parent, group, icon, colour, href, tier, stage, names, audience, position. Never deleted |
| `launcher_pins` | Each user's pins, in order |
| `launcher_feedback` | Ratings and notes per app |
| `launcher_versions` | Published builds: `YYYY.MM.DD-<commit>`, profile, capabilities, commit, when, by whom |
| `launcher_channels` | stable/beta/preview/variants → a version, with label and audience |
| `launcher_channel_choices` | Each user's chosen channel per app |
| `user_version_activity` | Who opened which version on which day (Trials) |

Every change is audited (`app.registered`, `app.changed`, `app.audience_changed`,
`app.moved`, `app.version_published`, `app.channel_moved`, `app.channel_changed`).
Default tiles live in code (`defaults.go`), and code owns each one until an administrator
changes it: at start-up a missing default is inserted and an untouched one takes the code's
fields (audited by no one); one an administrator edited is never overwritten.

**API.** `GET /api/v1/launcher` (the user's tiles, pins, the channels they see and their
choices), `PUT /api/v1/launcher/pins`, `POST /api/v1/launcher/feedback`,
`PUT /api/v1/launcher/choices/{slug}`; Manage apps under `/api/v1/apps…`
(`apps.manage`); the public page route `GET /apps/{slug}/{rest...}`.

**Addresses of a published app.** `/apps/<slug>/` is Stable, `/apps/<slug>/<channel>/` a
channel, `/apps/<slug>/@<version>/` one exact build; anything after is the app's own
screen. The API reads that version's `index.html`, rewrites `./` links to the files
address, and adds four meta tags: `ppe-mount`, `ppe-files`, `ppe-version`, `ppe-channel`.

**Profiles.** A build declares capabilities in `ppe-app.json`; they map to a closed list:

| Profile | Capabilities | Policy |
|---|---|---|
| `standard` | none | The staff app's Content-Security-Policy |
| `device` | `wasm`, `workers`, `camera` (any) | Plus `'wasm-unsafe-eval'`, `worker-src 'self'`, `camera=(self)` |

The API sends the page's policy, Caddy the files'; `TestPublishedPoliciesMatchCaddy` keeps
them equal. A new capability or profile is a reviewed code change.

**Publishing.** `api -publish-app <slug> -version <v> [-channel <c>]` reads a tar of `dist/`
on standard input (≤ 5000 files, 300 MB, no links, nothing outside it), moves it into
`API_APPS_DIR/<profile>/<slug>/<version>/` and records it. A version is never replaced.
`make prod-up` publishes `PUBLISHED_APPS` from the deployed image to Preview;
`make prod-publish APP= REF= [CHANNEL=]` builds any git ref on the droplet and publishes it.
Then `prod-up` prunes: per app it keeps every version a channel points at and the newest
five. It publishes nothing from a checkout with local changes. Builds are not backed up:
they are meant to be rebuilt from git, which today works only for a version not yet
recorded (critique S1).

**In every app.** `@ppe/app-shell` sends `X-PPE-App: <slug>` (and `X-PPE-App-Version` from a
published page), so the Audit log, Security, System's errors and Usage name the app and
version. `@ppe/launcher` loads the user's list once per page (`useLauncher`) for the
**Apps** entry, ⌘K and the landing rule (`hasSeveralApps`). `@ppe/routing` gives
`basePath` and `filesBase` from the meta tags. `ChannelStripe` marks a page off Stable and
sends anyone not allowed on that channel back to Stable.

## 6. Designing a new app

### Choose the simplest home first

| Need | Do this | Cost |
|---|---|---|
| A new screen for the same people | A screen in the staff app (or Administration), plus a **shortcut** tile if it deserves one | Lowest: one app, one review, one release |
| Quick access to an existing screen | Register a **shortcut** on Manage apps | Minutes, no code |
| A system that already exists elsewhere | Register a **linked** tile (↗) | Minutes, no code; its own sign-in |
| A different audience, device or trust level, or a trial you want to roll back separately | A **published app** in `web/apps/<slug>` | A day to set up, then free per release |
| Code not reviewed here (a vendor's POC) | Not on this site: a linked site now, the sandbox domain later (ADR 0006 phase 4) | — |

The default answer is the first row. ADR 0001 keeps one staff app of modules; a separate
app is justified by another audience, another device or another trust level, not by
another team or another feature.

### Checklist for a published app

1. `make new-app SLUG=<slug> NAME='<name>' NAME_LT='…' NAME_RU='…'` starts `web/apps/<slug>/` from
   `web/templates/published-app`: `ApiProvider app="<slug>"`, `SignedIn` and `AppFrame`, a first
   screen, words in EN, LT and RU, `csp.test.ts` and the Tailwind test; `vite.config.ts` and
   `public/ppe-app.json` (`{"slug", "capabilities": [], "devPort"}`, the next free port). The
   manifest is what makes it a published app: the build, the deploy, the dev proxy and e2e find it
   there. It also adds the tile to `defaults.go` in POC (Testers only): a deploy and e2e publish only
   a registered app. Set the tile's group, icon and colour there (it runs `pnpm install` for you).
2. Add a capability to the manifest only when needed: each one widens the policy (then test that
   profile's policy, as Scan SIMs' `csp.test.ts` does).
3. Use `basePath` for the router and `filesBase` for your own static files, never `import.meta.env.BASE_URL`.
4. Add screens as tabs of `AppFrame` (the template's router has one); let each screen's
   `PageHeader` be the only sticky header, as `AppFrame`'s bar scrolls away.
5. Tests: the app's unit tests and an e2e step (Vite mode uses its dev server; Caddy mode publishes it).
6. Ship: deploy → it lands on Preview (and Stable, the first time) → Testers try it → move its stage
   on Manage apps when it is for everyone.

### Rules that keep it simple

- One sign-in, one origin, one API. Never a second backend for an app; API changes stay additive.
- Access is by permission in the API; the tile's audience only hides tiles.
- A version is immutable; to change it, publish another.
- No app-specific Caddy, DNS or CSP edits; if you need one, it is a new profile and a review.
- Words in all three languages from day one; Help covers it like any other screen.

## 7. Critique

Reviewed again on 2026-11-05, after improvements 1–9, through four lenses: **safety**, **simplicity**,
**efficiency** and **maintainability**. Each finding was checked against the code and names where it is.

### What works well (keep it)

- **The trust boundary is explicit**: only code reviewed here runs on the site, with the user's sign-in; anything else is a linked site.
- **Publishing is careful**: `untar` refuses links, devices, `..` and absolute names, caps size and file count, extracts beside the destination and renames it into place; a version is never replaced.
- **Rolling back moves a pointer**: pruning and moving a channel lock the same app row, a foreign key backs it, and choices are kept by channel name, so pruning never strands one.
- **Policies come from a closed list**: files live under their profile, Caddy serves only the known ones, and tests keep the Go and Caddy copies (and the icon lists) equal.
- **Cheap where it is used most**: one `GET /api/v1/launcher` per page, shared by the frame, the stripe and the staff app's sign-in.
- **A new app is one command**, and CI builds the template, so it cannot rot unnoticed.

### Safety

- **S1. A lost `published` volume is never rebuilt** (High). The docs say builds are rebuilt from git rather than backed up, but `api -publish-app` writes files only for a version it has no row for. After a restore onto a new droplet, or a lost volume, the database names versions whose folders are gone: `/apps/sim-scan/` answers 500, and `prod-up` or `prod-publish` reports "already published" and writes nothing. *Where:* `cmd/api/publish-app.go:61-81`.
- **S2. Signing in as someone else on the same page shows the previous user's launcher** (Medium). `useLauncher` keeps the last list until the new user's arrives, the launcher copies pins and choices into state once, and signing out does not reload the page. On a shared tablet, B briefly sees A's tiles and pins; pinning then saves A's pins to B's account. Every app's Apps entry and channel stripe read the same stale list. *Where:* `@ppe/launcher` `load.ts:57-68`; `apps/launcher/src/app.tsx:80,84`.
- **S3. A channel's audience decides who sees it, not who can open it, and the check fails open** (Medium). The page route is public by design (the data stays behind the API's permissions), so the stripe's redirect is the only gate, and it lets anyone stay while the list loads or fails. A Preview or variant build, or any kept `@<version>`, opens for anyone with the link, signed out included. Nothing in the spec says so. *Where:* `channel-stripe.tsx:27`; `published-app-routes.go:41,54`.
- **S4. Gaps in the audit trail and half-done publishes** (Low). A new variant's audience is not recorded (only `app.channel_moved`). Publishing to an unknown variant records the version before refusing. Two publishes of one version at once can delete the first one's files. The `prod-up` publish pipe has no `pipefail`, so a cut-off tar might be published as complete (suspected, not shown). *Where:* `service_versions.go:93,107,201`; `publish-app.go:71`; `Makefile` prod-up.
- **S5. Production runs a Caddy no test ran** (Low). The web image is `FROM caddy:2-alpine`, while CI and `make e2e-caddy` pin `CADDY_VERSION` and its checksum. A rebuild can pick up a Caddy the policies and redirects were never tested on. *Where:* `web/Dockerfile:33`.
- **S6. Failures the user never sees** (Low). Saving pins or a channel choice reverts silently when it fails. **Back to Stable** swallows a failed save, and the Stable address then sends the user straight back to the channel they chose. Device pins from phase 1 are deleted before the API has saved them. *Where:* `apps/launcher/src/app.tsx:98-118`; `channel-stripe.tsx:43-47`.

### Simplicity

- **P1. A lot of machinery for one app** (Medium). About 1,900 lines (versions, channels, the page route, publishing and pruning, the stripe, Releases, Trials, three migrations) serve Scan SIMs alone. Variants with audiences, per-user choices, Stable follows deploys and Trials have not been needed by a second app yet. Capabilities are decorative: declaring any one gives the whole device profile. *Where:* `internal/domain/launcher/versions.go:31-41`.
- **P2. Fixed ports are written in six places** (Medium). The staff app's, Administration's and the launcher's ports are listed in `new-app.ts`, `e2e/env.ts`, two Vite configs, `.claude/launch.json` and CLAUDE.md; `make new-app` adds nothing to `launch.json`. *Where:* `new-app.ts:55`; `e2e/env.ts:14-18`.
- **P3. Repeated code** (Low). The launcher repeats `SignedIn`; Administration repeats the launcher's stage and rating words in three languages; three Playwright server entries are near copies; the template's Vite config is Scan SIMs' minus two plugins. *Where:* `apps/launcher/src/app.tsx:48-73`; `e2e/playwright.config.ts:60-87`.

### Efficiency

- **E1. Every page load redoes the same work** (Low). Opening a published app runs three queries (one loads every app's channels and filters in Go), reads `index.html` from disk and rewrites it, and is sent `no-cache` without an ETag, so it is never a 304. A version's page never changes. *Where:* `service_versions.go:258-270,439`; `published-app-routes.go:72-96`.
- **E2. One dev and e2e server per published app** (Low). Every published app starts its own Vite server in development and e2e, whether a test uses it or not; the cost grows with each app. *Where:* `e2e/playwright.config.ts:70-77`.

### Maintainability

- **M1. Rules copied by hand with no test** (Medium). The slug rule and reserved slugs are in Go, in `new-app.ts` and in Administration (for slugs and variant names), and must also match Caddy's `/apps/` paths. The profile's policy is an if/else, so a third profile would silently get the staff policy. *Where:* `app.go:120,123`; `apps/admin/src/lib/apps.ts:90,137`; `published-app-routes.go:89-94`.
- **M2. A variant can take a screen's address** (Low). The first path segment is a channel when one has that name, so a variant called `find` would take over Scan SIMs' `/find` for everyone. *Where:* `service_versions.go:478-481`.
- **M3. Leftovers are never cleaned** (Low). A killed publish leaves `.incoming/` behind, and folders no version names stay, and Caddy serves them. *Where:* `publish-app.go`; `Caddyfile:60-65`.
- **M4. Risky paths without tests** (Low). `untar` is tested only with `../`: not with links, absolute names, duplicates or its caps. Nothing tests publishing a recorded version whose files are gone, a page with no `</head>` (its meta tags are dropped silently), the stripe's redirects, or `useLauncher` when the user changes; S1, S2 and S6 would have shown there. *Where:* `api_postgres_test.go:2082`.
- **M5. Small slips** (Low). `X-PPE-App-Version` is set twice on downloads; Scan SIMs' `package.json` still says `/sim-scan`; `make new-app` copies the template before checking its placeholders, so a bad template leaves a half-made folder. *Where:* `api-client/src/client.ts:176-177`; `new-app.ts:96-102`.

### The first review, and where it stands

| # | Finding | Now |
|---|---|---|
| 1 | Deploys did not reach users by themselves | Stable follows deploys; a note while Preview is ahead (1) |
| 2 | A new published app needed edits in five places | Found from its manifest (2); `make new-app` (4) |
| 3 | A lot of machinery for one app | Still open: P1 |
| 4 | Each app copied its own frame | `AppFrame` for small apps (3) |
| 5 | Versions were hard to find | The choice is honoured at the app's address; the stripe switches (5) |
| 6 | Old versions piled up | Pruning and the dirty-checkout check (6) |
| 7 | Two sources for tiles | Code owns a default until an administrator changes it (7) |
| 8 | Feedback and errors were read apart | Trials on Manage apps (8) |
| 9 | Published serving was rarely tested locally | `make e2e-caddy` (9) |

## 8. Proposed improvements

Sorted by value for effort; each keeps the number of moving parts the same or lowers it.

| # | Change | Fixes | Lens | Effort | Status |
|---|---|---|---|---|---|
| 10 | **Rebuild what is missing**: `-publish-app` writes the files whenever `<version>/index.html` is missing, recorded or not, and skips a complete folder; `-prune-apps` removes `.incoming/` and folders no version names; tests for both | S1, S4, M3 | Safety | S | Proposed |
| 11 | **One launcher list per user**: `useLauncher` returns a list only for the signed-in user; `<Launcher key={userId}>`; a test that changes the user | S2 | Safety | S | Proposed |
| 12 | **Pin production's Caddy**: `FROM caddy:${CADDY_VERSION}-alpine`, from the value `ci.yml` pins and checks | S5 | Safety | S | Proposed |
| 13 | **Say what an audience is, and fail closed**: The spec and this handbook: an audience chooses who sees a channel, not who may open it; off Stable with the list failed, go to Stable; the stripe links to `/stable/`, which keeps the choice from sending the user back | S3, S6 | Safety | S | Proposed |
| 14 | **Finish publishes in the right order**: `app.channel_changed` for a new variant's audience; the variant checked in `CheckPublish`; `pipefail` on the publish pipe | S4 | Safety | S | Proposed |
| 15 | **Show failures in the launcher**: A message when saving pins or a choice fails; device pins removed only after the save | S6 | Safety | S | Proposed |
| 16 | **One slug rule, one profile map**: The slug rule and reserved slugs exported once from `@ppe/launcher` and read by a Go test (as the icons are); `map[Profile]policy` with a test that every profile has a policy and a Caddy matcher, and that reserved slugs match Caddy's `/apps/` paths | M1 | Maintainability | S | Proposed |
| 17 | **Fill the test gaps**: `untar` with links, absolute names, duplicates and its caps; a recorded version without files; a page without `</head>`; the stripe's redirects | M4 | Maintainability | S | Proposed |
| 18 | **Cache a version's page**: The rewritten `index.html` kept in memory by version id with an `ETag`; channels read for one app | E1 | Efficiency | S | Proposed |
| 19 | **Small tidy-ups**: The launcher on `SignedIn`; Administration reads the launcher's words; one Playwright server helper; the slips in M5 | P3, M5 | Simplicity | S | Proposed |
| 20 | **Ports in one place**: The staff app, Administration and the launcher declare their `devPort` like published apps, read by the Vite configs, e2e and `new-app.ts`; `launch.json` checked against them | P2 | Simplicity | M | Proposed |
| 21 | **Freeze channel features until a second app**: No new channel features until a second published app needs them; the manifest names its profile instead of capabilities that all mean `device` | P1 | Simplicity | S | Proposed |
| 22 | **Channels apart from screens**: Refuse a variant named like one of the app's first-level screens, or move channels under a prefix (`/apps/<slug>/~beta/`, old addresses redirected) | M2 | Maintainability | S–M | Proposed |
| 23 | **Start only the servers a run needs**: An `E2E_APPS=` filter, once a third app makes startup noticeable | E2 | Efficiency | S | Proposed |

**Order.** 10, 11 and 12 first (one each, small, and S1 and S2 can hurt today), then 13–16, then the rest as the code is touched. 20–23 can wait for a second published app.

### Built (2026-11-05)

| # | Change |
|---|---|
| 1 | Promote after deploy, per app: **Stable follows deploys**; a note while Preview is ahead |
| 2 | Published apps found from their manifest by the build, deploy, dev proxy and e2e |
| 3 | `AppFrame` in `@ppe/launcher`, shared by Scan SIMs and the launcher, with a scroll test |
| 4 | `make new-app SLUG=` from a template; CI builds the template |
| 5 | The choice honoured at the app's own address; the stripe switches channels |
| 6 | `api -prune-apps` in `prod-up`; no publishing from a dirty checkout |
| 7 | Code owns a default tile until an administrator changes it, audited |
| 8 | Trials on Manage apps: opens, errors and feedback per version |
| 9 | `make e2e-caddy`: the suite behind Caddy at CI's pinned version, in Docker |

**Simplicity check before building more.** Most findings are small and safety comes first: three of them (S1, S2, S5) can bite today and each fix is a few lines. The structural question is still P1. Before a second published app, decide which channel features earn their keep; if none of variants, per-user choices and Trials is used in three months, remove them rather than maintain them.
