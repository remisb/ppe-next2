# ADR 0006: App Launcher, with hosting tiers, versions and channels

- **Status:** accepted (2026-11-04, with every decision the guide recommends, D1 to D12);
  phases 1 and 2 built 2026-11-04 (`docs/specs/app-launcher.md`; phase 2 with audiences by
  permission, channels moved to phase 3, and shortcuts kept in the registry too); phase 3
  built 2026-11-04, with decisions 4 and 5 changed as "As built, phase 3" below says
- **Date:** 2026-10-30
- **Scope:** frontend (`web/apps`, `@ppe/app-shell`, `@ppe/routing`), backend (Go API,
  Postgres, files store), deployment (Caddy, CI, DNS)
- **Builds on:** [ADR 0001](0001-modular-monolith-with-bounded-contexts.md) (one staff app
  of modules; separate apps only for another audience or trust level),
  [ADR 0002](0002-permissions-and-administration-app.md) (a second app on the same origin),
  [ADR 0005](0005-sim-codes-and-scan-sims-trial.md) (Scan SIMs as a trial app with its own CSP)
- **Handbook:** [docs/ux/app-launcher-handbook.md](../../ux/app-launcher-handbook.md) (use, building an app, critique and improvements, as built)
- **Guide:** [docs/ux/app-launcher.md](../../ux/app-launcher.md) (research, UI samples, flows,
  the decisions with recommendations) and its
  [clickable prototype](../../ux/mockups/app-launcher.html)

## Context

The company's apps are multiplying: the staff app at `/`, Administration at `/admin/`, the
Scan SIMs trial at `/sim-scan/`, and PPE Crew (`../PPE-staff`), a separate system with its
own API, database and roles at `crew.167.71.68.195.sslip.io`, served by this droplet's Caddy.
More proofs of concept, trials and versions will follow.

Facts that bear on it:

- **Adding an app touches about twelve places by hand:** a Caddy `handle_path` block and
  root variable, a CSP line and three `csp.test.ts`, `web/Dockerfile`, the staff app's Vite
  proxy, the e2e servers and CSP list, `@ppe/routing`, `.claude/launch.json`, and the app's
  identity in the API (`AppName` in `api-client/src/client.ts`, `requestSource` in
  `cmd/api/request.go`, `audit.Source`, `usage.Apps` and the CHECKs of migrations 0023 and
  0027). Scan SIMs skipped the last and reports as `workwear`.
- **There are no versions.** Everyone runs the build in the image. A trial cannot be shown
  to a few testers while others keep the current one, nor two designs compared.
- **The origin is the trust boundary.** The refresh cookie `ppe_refresh` (path
  `/api/v1/auth`, HttpOnly, SameSite=Strict, `cmd/api/auth-cookie.go`) lets any page on the
  origin get a token with all of its user's permissions.
- **Apps are found by address.** No link leads to Scan SIMs; PPE Crew is known by its link.

The ask: one place where people find only the apps their roles use, laid out like a till or
the Shortcuts app, that can also hold POCs, test apps and several versions and variants of an
app, without DNS or address work for each.

## Decision

1. **App Launcher is a separate app at `/apps/`** on the staff app's origin, sharing its
   sign-in through `@ppe/app-shell`. It is a front door, not a frame: apps open as pages. No
   app loses a row to it: the way back is an **Apps** entry in each app's own menu (More on a
   phone, the sidebar elsewhere) and in ⌘K. An app may allow, and a person turn on, a header
   icon; full-screen modes never show one. A stripe and a dot mark a version off Stable. `/` stays the staff app. A user whose
   roles see one app goes straight to it.
2. **Three hosting tiers, by trust.**
   - *Built here:* code built and reviewed in this repository, served on the origin at
     `/apps/<slug>/`, with the user's sign-in.
   - *Sandbox:* outside or unreviewed code, served at `<slug>.<sandbox domain>`, a separate
     registrable domain with one wildcard DNS record set once and Caddy on-demand TLS whose
     `ask` is the registry. It never receives the sign-in. Real data, if ever needed, comes
     through a short-lived token limited to the routes its manifest names.
   - *Linked:* a separate system at its own address with its own sign-in (PPE Crew).
3. **A registry of apps, versions and channels.** An app has a slug, names in EN/LT/RU, an
   icon, a colour, a group, an owner, a stage (Live, Pilot, POC, In development, Retired) and
   an audience (roles). A version is an immutable published build. A channel (Stable, Beta,
   Preview, or a named variant) points at one version and has its own audience. Shortcuts
   are tiles that open a screen in an app. The audience decides who sees a tile; the API's
   permissions still decide what anyone can do. Started as a static list in code, then kept
   by the API (`internal/domain/launcher`, `GET /api/v1/launcher`) and managed on
   Administration's **Manage apps** (`apps.manage`). Testers are a built-in role and turn on
   **Show apps in testing**.
4. **Built-here apps need no config.** Caddy sends `/apps/*` to the API. The API serves each
   version from the files store: `index.html` without caching, with its asset links rewritten
   to `/apps/<slug>/@<version>/assets/…` (cached for a year) and a `ppe-mount` meta tag for
   the router; the CSP is built from a closed list of capabilities the manifest declares
   (`wasm`, `workers`, `camera`). Addresses: `/apps/<slug>/` is Stable,
   `/apps/<slug>/<channel>/` a channel, `/apps/<slug>/@<version>/` one build.
5. **CI publishes; people move channels.** `make app-publish` (`api -publish-app`) uploads a
   build with a deploy token that can do nothing else. Promoting and rolling back move a
   channel's pointer; both are audit events. No upload from the browser.
6. **One API.** Versions are front-ends only. API changes stay additive and ship first; a
   manifest names the oldest API it needs, and the launcher hides a channel the running API
   cannot serve. Requests carry `X-PPE-App: <slug>` and `X-PPE-App-Version`, so Usage and
   System's error list read per app and version.

### As built, phase 3

- **Caddy serves the files, the API the page.** The API's `Timeout` middleware buffers every
  answer in memory, so it does not stream builds. A version's files are in the `published`
  volume (`API_APPS_DIR`, Caddy's `PUBLISHED_ROOT`) at `<profile>/<slug>/<version>/`, served
  by Caddy at `/apps/files/<profile>/<slug>/<version>/…`, cached for a year. The API answers
  only `index.html` for `/apps/<slug>/…` (Stable, `/<channel>/`, `/@<version>/`, and any
  deeper path, the app's own screens), with its relative links rewritten to those files and
  `ppe-mount`, `ppe-files`, `ppe-version` and `ppe-channel` meta tags.
- **Profiles, not a policy per manifest.** The capabilities a build declares
  (`ppe-app.json`: `wasm`, `workers`, `camera`) map to a closed list of profiles: `standard`
  (none, the staff app's policy) and `device` (any, ADR 0005's Scan SIMs policy with the
  camera). The policy is chosen by path, so a worker's script gets it too; the API's copies of
  both are kept equal to Caddy's by a test.
- **Published on the droplet, from git, by people.** No CI token: `make prod-publish APP= REF=
  [CHANNEL=]` builds the app at a git ref with that commit's web Dockerfile and pipes it to
  `api -publish-app`; `make prod-up` publishes the deployed commit of each published app to
  Preview (and to Stable, for an app with none yet). Stable, Beta and variants move on Manage
  apps. A version is `YYYY.MM.DD-<commit>`, never replaced.
- **Who sees a channel:** Stable whoever sees the tile; Beta, Preview and variants testers,
  or the permissions a channel names. A tester's choice is kept per user by the API and
  opens the tile on it; a published app moves anyone on a channel they do not see to Stable.
- Not built: a manifest's oldest API (decision 6).
- Since 2026-11-05 (the handbook's improvements 1, 3, 5 and 6): a per-app **Stable follows
  deploys** switch; small apps share `AppFrame`, whose bar scrolls away; a tester's channel
  choice is honoured at the app's own address; `make prod-up` prunes versions no channel opens
  beyond the newest five and publishes nothing from a dirty checkout. Then 7, 8 and 9: code owns
  a default tile until an administrator changes it (synced at start-up, audited); phase 5's
  **Trials** view on Manage apps (each version's people, errors and feedback; migration 0045);
  `make e2e-caddy` runs the suite behind the production Caddy config from Docker. Then the
  second review's 10–23 (the handbook): missing files rebuilt by publishing again, one launcher
  list per user, a pinned production Caddy, audiences that hide rather than guard (the stripe
  fails closed), save errors shown, one slug rule, tests for untar and every profile, a page
  cached per version with an `ETag`, ports declared once, `E2E_APPS`; the manifest now names
  its **profile** (capabilities stay readable for older builds) and its **screens**, which no
  variant may be named like (migration 0046). No new channel feature is built until a second
  published app needs one.

## Consequences

- A new app or version costs a registration and a CI publish, with no Caddy, Dockerfile,
  DNS or CSP edit. Scan SIMs moves under `/apps/` first, and its Caddy block and CSP line go.
- The API serves static files for `/apps/*`. Load is small (ADR 0001), so this is acceptable;
  `index.html` is small and assets are cached immutably.
- The capability list becomes security policy in code: adding a capability is a reviewed
  change, as a new CSP line is today.
- The trust boundary is written down: nothing outside this repository's review runs on the
  origin. A sandbox domain is bought and kept.
- App identity widens from `workwear | admin` to the registry's slugs, which touches the
  audit source and usage CHECKs once.
- PPE Crew keeps a second sign-in until it merges in as ADR 0001 plans.
- Help and the e2e suite gain the launcher; `pnpm guide` gains its screenshots.

## Plan

Phases, each usable alone (details in the guide's Roadmap): 0 decide and test the prototype
with people; 1 the launcher with a static list; 2 the registry in the API and Manage apps;
3 versions and hosting at `/apps/`; 4 the sandbox domain; 5 a Trials view of opens, errors and
feedback per version.
