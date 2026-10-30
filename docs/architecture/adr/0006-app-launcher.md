# ADR 0006: App Launcher, with hosting tiers, versions and channels

- **Status:** proposed
- **Date:** 2026-10-30
- **Scope:** frontend (`web/apps`, `@ppe/app-shell`, `@ppe/routing`), backend (Go API,
  Postgres, files store), deployment (Caddy, CI, DNS)
- **Builds on:** [ADR 0001](0001-modular-monolith-with-bounded-contexts.md) (one staff app
  of modules; separate apps only for another audience or trust level),
  [ADR 0002](0002-permissions-and-administration-app.md) (a second app on the same origin),
  [ADR 0005](0005-sim-codes-and-scan-sims-trial.md) (Scan SIMs as a trial app with its own CSP)
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
