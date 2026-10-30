# App Launcher

A front door for the company's apps: big tiles, as on a till or in the Shortcuts app, showing
each person only the apps their roles use, and a way to put POCs, trials and new versions in
front of chosen testers without DNS or Caddy work. The interactive guide, with the research,
UI samples, flows, decisions and test plan, is [app-launcher.html](app-launcher.html); the
clickable prototype (five people, phone/tablet/desktop, EN/LT/RU, eight guided flows) is
[mockups/app-launcher.html](mockups/app-launcher.html).

30 Oct 2026 · sample data · status: **proposed**; decision in
[ADR 0006](../architecture/adr/0006-app-launcher.md). Terms go into
[ubiquitous-language.md](../ubiquitous-language.md) once it is accepted.

## Why

- Adding Scan SIMs touched about twelve places by hand (Caddy block and CSP line, three
  `csp.test.ts`, `web/Dockerfile`, Vite proxy, e2e, `@ppe/routing`, app identity in the API),
  and it still reports as `workwear`.
- Everyone gets the same build: no beta for testers, no side-by-side variants.
- PPE Crew (`../PPE-staff`, at `crew.167.71.68.195.sslip.io`) is found only by its link.
- The refresh cookie lets any page on the origin act with the user's full permissions, so
  only reviewed code may run there.

## Proposal

- **App Launcher** at `/apps/`, sharing the staff app's sign-in; `/` stays Workwear; people
  with one app skip it.
- **Hosting tiers:** *Built here* at `/apps/<slug>/` with the sign-in; *Sandbox* on a
  separate domain with one wildcard record and on-demand TLS, no sign-in; *Linked* sites
  such as PPE Crew with their own.
- **No extra row in any app:** the way back is an **Apps** entry in each app's own menu
  (More on a phone, the sidebar elsewhere) and ⌘K; a header icon only for people who turn
  it on. A stripe and a dot show only when someone is off Stable.
- **Registry:** apps (group, stage, owner, audience), shortcuts into screens, immutable
  **versions** and movable **channels** (Stable, Beta, Preview, named variants). Static
  first, then in the API with **Manage apps** on Administration.
- **No config per app:** Caddy sends `/apps/*` to the API, which serves each build from the
  files store with a CSP from declared capabilities (`wasm`, `workers`, `camera`). CI
  publishes; promoting and rolling back move a pointer.

## Decisions (recommended first)

| | Question | Recommended |
|---|---|---|
| D1 | Launcher address | `/apps/`; Workwear stays at `/` |
| D2 | Where the list lives | Static in code, then the API registry |
| D3 | Serving versioned builds | The API, from the files store, CSP from capabilities |
| D4 | Addresses | `/apps/<slug>/` Stable, `/<channel>/`, `/@<version>/` |
| D5 | Trying two designs | A variant is a channel |
| D6 | Who publishes | CI only, with a deploy token |
| D7 | Sandbox domain | A separate registrable domain (else `*.apps.gavort.nl`; sslip.io on day one) |
| D8 | PPE Crew sign-in | Linked now; one sign-in when it merges in |
| D9 | Who sees apps in testing | A Testers role plus **Show apps in testing** |
| D10 | One-app users | Skip the launcher |
| D11 | Feedback | Stored with app, version, device, language; read on Manage apps |
| D12 | The way back to the launcher | An Apps entry in each app's menu and ⌘K; a header icon on request; no extra row |

## Roadmap

0 decide and test the prototype with 5–8 people · 1 launcher with a static list (S) ·
2 registry and Manage apps (M) · 3 versions and hosting at `/apps/` (M–L) · 4 sandbox
domain (M) · 5 Trials view: opens, errors and feedback per version (S–M).
