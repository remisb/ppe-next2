# App Launcher handbook

How App Launcher works today, how people use it, how an app joins it, how new
apps should be designed, and what should change next. For everyone who uses the
apps, administers them or builds them.

As of 2026-11-05: production `b276a0a`; improvements 1, 2, 3, 5, 6, 7, 8 and 9 built on main since. Decisions: [ADR 0006](../architecture/adr/0006-app-launcher.md).
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

**Registry** (`internal/domain/launcher`, migrations 0042–0043):

| Table | Holds |
|---|---|
| `launcher_apps` | Tiles: slug, kind, parent, group, icon, colour, href, tier, stage, names, audience, position. Never deleted |
| `launcher_pins` | Each user's pins, in order |
| `launcher_feedback` | Ratings and notes per app |
| `launcher_versions` | Published builds: `YYYY.MM.DD-<commit>`, profile, capabilities, commit, when, by whom |
| `launcher_channels` | stable/beta/preview/variants → a version, with label and audience |
| `launcher_channel_choices` | Each user's chosen channel per app |

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
they are rebuilt from git.

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

1. `web/apps/<slug>/` from the Scan SIMs layout: React, `@ppe/app-shell` (`ApiProvider app="<slug>"`), `@ppe/ui`, `@ppe/i18n` (EN, LT, RU).
2. `vite.config.ts`: `base: command === 'build' ? './' : '/apps/<slug>/'` and the manifest's `devPort`, as Scan SIMs' reads them.
3. `public/ppe-app.json`: `{"slug": "<slug>", "capabilities": [], "devPort": 5188}`; add capabilities only when needed (they widen the policy). This file is what makes it a published app: the build, the deploy, the dev proxy and e2e find it from here.
4. Never read `import.meta.env.BASE_URL` for addresses: use `basePath` (router) and `filesBase` (your own static files).
5. Wrap it in `@ppe/launcher`'s `SignedIn` and `AppFrame` (the channel stripe, a way back, the Apps entry, Sign out, tabs) instead of building a frame.
6. Let each screen's `PageHeader` be the only sticky header; `AppFrame`'s bar scrolls away.
7. Register the tile on Manage apps (*On this site*, href `/apps/<slug>/`), or add it to `defaults.go` if every installation needs it.
8. Tests: the app's unit tests, its `csp.test.ts`, an e2e step (Vite mode serves the dev server; Caddy mode publishes it).
9. Ship: deploy → it lands on Preview → try it → **Make Stable**.

### Rules that keep it simple

- One sign-in, one origin, one API. Never a second backend for an app; API changes stay additive.
- Access is by permission in the API; the tile's audience only hides tiles.
- A version is immutable; to change it, publish another.
- No app-specific Caddy, DNS or CSP edits; if you need one, it is a new profile and a review.
- Words in all three languages from day one; Help covers it like any other screen.

## 7. Critique

What works well: the trust boundary is explicit; the registry is boring SQL with an
audit trail; rollback is a pointer move; the security policy is chosen by a closed list
and tested against Caddy; users get exactly their apps with no new sign-in.

What does not, in order of impact:

1. **Deploys do not reach users by themselves.** *Eased: Stable follows deploys and the Preview-ahead note (improvement 1).* A deploy moves Preview only, so a fix
   reaches nobody until someone remembers **Make Stable**. This happened on 2026-11-05:
   the Scan SIMs header fix was deployed but Stable stayed on the old build. Safe, but easy to forget.
2. **"No config per app" is not true yet.** *Fixed: published apps are found from their manifest (improvement 2).* A new published app still needs edits in
   five places outside its folder (Makefile list, Dockerfile build filter and copy, Vite
   proxy, e2e server and port), besides registering its tile.
   ADR 0006 promised a registration and a publish.
3. **A lot of machinery for one app.** Volume, API page route, rewriting, two policy
   copies, publish command, build script, three tables: justified only if a second and
   third published app follow. Today Scan SIMs alone uses it.
4. **Each app copies its own frame.** *Fixed for small apps: `AppFrame` (improvement 3); the staff app, Administration and the launcher keep theirs.* Workwear, Administration, Scan SIMs and the launcher
   each build header, Apps entry, sign-out and gates. The overlapping-headers bug came
   from exactly this: a shared screen header met a copied frame no test scrolled.
5. **Versions are hard to find.** *Eased: the choice is honoured at the app's own address and the stripe switches channels (improvement 5); discovering Beta still needs ⋯.* A tester must open ⋯ on the tile to discover Beta;
   bookmarks and the staff app's links always open Stable, whatever the tester chose.
6. **Old versions pile up.** *Fixed: pruning and the dirty-checkout check (improvement 6).* Nothing prunes the `published` volume (about 16 MB per Scan
   SIMs build); a build from a dirty checkout gets a clean-looking version name.
7. **Two sources for tiles.** *Fixed: code owns a default until an administrator changes it; untouched defaults follow the code, audited (improvement 7).* Default tiles live in code and in the database; renaming a
   default in code does not rename it where it already exists.
8. **Feedback and errors are not yet read together** *Fixed: Trials on Manage apps (improvement 8).* per version (phase 5, the Trials view),
   so "is Beta better?" is still answered by hand.
9. **Caddy-mode tests need Caddy** *Fixed: `make e2e-caddy` (improvement 9); it also found a racy Item Catalogue step.*, so most local runs never exercise published serving;
   CI does.

## 8. Proposed improvements

Sorted by value for effort. Each keeps or reduces moving parts.

| # | Change | Fixes | Effort | Status |
|---|---|---|---|---|
| 1 | **Promote after deploy, per app**: a switch "Stable follows deploys" on Manage apps (on for apps with no testers); otherwise the Overview lists "Preview is newer than Stable for N days" | 1 | S | Built 2026-11-05 |
| 2 | **Discover published apps from the build**: any `web/apps/*/public/ppe-app.json` is published; Dockerfile copies `apps/*/dist` with a manifest; one generic Vite proxy and e2e server entry per manifest | 2 | M | Built 2026-11-05 |
| 3 | **One shared frame for small apps**: `AppFrame` in `@ppe/app-shell` (bar that scrolls away, tabs, Apps entry, ChannelStripe, sign-out, gates) used by Scan SIMs and the launcher, with a scroll test | 4 | M | Built 2026-11-05 |
| 4 | **`make new-app SLUG=`**: scaffolds the folder, manifest, i18n, csp test and tile from Scan SIMs | 2 | S | Proposed |
| 5 | **Honour the choice everywhere**: `/apps/<slug>/` redirects a tester to their chosen channel; the stripe also offers **Versions** | 5 | S | Built 2026-11-05 |
| 6 | **Prune**: `api -prune-apps` keeps every version a channel points at plus the last N, run by `prod-up`; refuse dirty builds in `prod-up` | 6 | S | Built 2026-11-05 |
| 7 | **Code owns a default until an administrator changes it**: untouched default tiles follow `defaults.go` at start-up, audited; edited ones are never overwritten (instead of seeding once, which would need a migration per rename) | 7 | S | Built 2026-11-05 |
| 8 | **Trials view** (phase 5): opens, errors and feedback per app and version side by side | 8 | M | Built 2026-11-05 |
| 9 | **A pinned Caddy for local e2e**: `make e2e-caddy` runs the suite through the `caddy:2` image | 9 | S | Built 2026-11-05 |

**Simplicity check before building more.** All but 4 are built: today's single published app
is safe, invisible to users, measured per version and tested locally as in production, and a
second one needs no edit outside its folder. 4, a scaffold, is worth it once apps are added
often; copying Scan SIMs' folder does the same today.
