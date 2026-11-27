---
paths:
  - "web/**"
---

# Frontend rules (`web/`)

Loaded when Claude works under `web/`. The binding rules are `web/AGENTS.md`: read the
sections for what you change. Lint: `pnpm lint` (Biome) must pass.

pnpm workspace (pnpm 12, Node ≥ 22), React 19, TypeScript 7, Vite 8, Vitest 5, Tailwind 4,
shadcn/ui on Base UI, and ui-sdk (`@ui-sdk/react`, a beta, in `@ppe/ui`; its skill in `.claude/skills/ui-sdk`). Follow `web/AGENTS.md`.

```bash
cd web && pnpm install
pnpm typecheck && pnpm test && pnpm build           # whole workspace
pnpm --dir apps/workwear dev                         # http://localhost:5180, proxies /api and /admin
pnpm --dir apps/admin dev                            # Administration on 5182; open it at http://localhost:5180/admin/
pnpm --dir apps/sim-scan dev                         # Scan SIMs on 5184; open it at http://localhost:5180/apps/sim-scan/ (VITE_HTTPS=1: https on the LAN, for a phone's camera)
pnpm --dir apps/launcher dev                         # App Launcher on 5186; open it at http://localhost:5180/apps/
pnpm --dir apps/docs-import dev                      # Import Documents on 5188; open it at http://localhost:5180/apps/docs-import/ (VITE_HTTPS=1 for a phone's camera)
pnpm --dir apps/docs-scan dev                        # Scan Documents on 5190; open it at http://localhost:5180/apps/docs-scan/ (VITE_HTTPS=1 for a phone's camera)
pnpm --dir apps/workwear exec vitest run src/lib/working-order.test.ts   # one test file
```

The dev server proxies `/api` to `VITE_API_TARGET` (default `http://localhost:8090`; set it
in `apps/workwear/.env.local` when 8090 is taken) and `/admin` to `VITE_ADMIN_TARGET`
(default `http://localhost:5182`; the fixed apps' ports are `published-apps.ts`' `fixedApps`, which
`.claude/launch.json` must match), each published app's `/apps/<slug>` to its manifest's `devPort` (Scan SIMs 5184;
`VITE_APP_<SLUG>_TARGET`, such as `VITE_APP_SIM_SCAN_TARGET`, overrides it) and the rest of `/apps` to
`VITE_LAUNCHER_TARGET` (5186). `.claude/launch.json` has `api` (port 8090), `workwear`
(port 5180), `admin` (port 5182), `sim-scan` (5184), `launcher` (5186), `docs-import` (5188), `docs-scan`
(5190, and `docs-scan-https` for a phone's camera) and `ui-sdk-csp-spike` (5199) configs.

- `packages/api-client` is a **hand-written** typed client (`types.ts` mirrors the Go JSON);
  update it with every API change. Its `permissions.ts` lists the permission catalogue in
  Go's order (a Go test compares them). `packages/routing` holds where each app is mounted.
- Shared code is in packages, never copied into an app: `@ppe/ui` (shadcn components,
  `styles.css` tokens and variants, panels, relative dates), `@ppe/app-shell` (sign-in,
  session with `can(permission)`, Sign in, Confirm your password, theme, density, password
  rules, the router), `@ppe/i18n` (language machinery; packages keep small dictionaries of
  their own), `@ppe/backups`, `@ppe/audit` (how recorded changes read: actions, changed
  fields, the Changes section), `@ppe/scan-kit` (reading with the camera or from photos: the
  camera, barcode and text readers in workers, pictures, the readers' files' Vite plugin) and
  `@ppe/mrz` (passports' and ID cards' MRZ, for docs-import; its Go twin is `internal/personnel/mrz`, both tested on `testdata/mrz/vectors.json`), `@ppe/id-docs` (reading a document as rules: photo slots, the draft, Save's input, the page and portrait geometry; docs-import's, shared with docs-scan). `@ppe/ui` also wraps ui-sdk (`drawer.tsx` with the action sheet, `toast.tsx`, `gallery.tsx`, `image-cropper.tsx`); `@ppe/scan-kit`'s `live-camera` is the reading apps' camera hook. A screen shows controls by `session.can(...)`, never by role.
  A package with components of its own is named with `@source` in each app's `index.css`:
  Tailwind scans only the app's files and `@ppe/ui`, so its classes would be missing.
- **The employee's page** (WARE-47, `docs/ux/employee-page.md`): the Employees list opens an employee
  beside it (`/employees/<id>`); every other link (an order, SIM cards and Equipment, an item's Orders,
  Replacements due, the Employee Dashboard, ⌘K) opens `/employees/<id>/page` (route `employeePage`), the
  same `EmployeeDetail` (`routes/employee.tsx`, `place`) in two columns from its container's `@4xl`. A
  link's `from` label is kept with its history entry (`@ppe/app-shell`'s `fromOf`, `cameFrom`), and the
  page's way back names and returns there, else Employees; the pane has **Open page**.
- A record's header is its identity row, then its **action bar** (WARE-46,
  `docs/ux/record-actions.md`, Option B): `RecordHeader`'s `actions` is a `RecordAction[]`
  from one model per record kind (`lib/order-actions.ts`, `asset-actions.ts`,
  `employee-actions.ts`), drawn by `@ppe/ui`'s `ActionBar` (main action with words, icon tools
  from `actionIcons`, ⋯), collapsing by measured words (`layoutActions`), never wrapping.
- `apps/workwear/src/lib/working-order.ts` holds all Create Order rules as pure, tested
  functions (merge by item, manual-size conflicts on employee change, Save as Employee
  Default, validation, the draft kept per user in localStorage). Screens in `src/routes/` only wire events.
- Imports inside packages use explicit `.ts` extensions (`allowImportingTsExtensions`).
- Both apps are in English, Lithuanian and Russian (each user's choice, `users.language`,
  migration 0016): every visible word comes from `t` in the app's `src/i18n` (typed dictionaries per
  language and namespace; never read `t` at module level). The confirmation page, hand-over
  mode and the Items Given Record stay English / Russian. Rules in `web/AGENTS.md`.
- The user guide is the Help screen (`/help`): typed text in `src/help/{en,lt,ru}.ts`, each
  part limited to the roles that can do it and, where screens differ, to a phone, tablet or
  desktop, with that device's screenshots; `pnpm guide` writes `docs/guide` from it.
- **Do not update the user documentation as part of a change** (the Help text in
  `src/help/*.ts`, its screenshots in `public/help-img`, `docs/guide`, `pnpm guide`):
  the user asks for those updates separately. When a change leaves them out of date, say
  so in one line. Developer docs (`docs/testing.md`, `docs/specs/`, `web/AGENTS.md`, this
  file) are still updated with the change.
- **Lists open newest first** (WARE-55, principle 9 of `docs/ux/ui-ux-guidelines.md`): a list of
  records starts with the latest added (`@ppe/ui/lib/sort`'s `newestFirst` before `sortRows`, `allowNone`;
  Sort ▾ says Newest first; SIM Cards and Equipment ask the API for `sort=added&dir=desc`); only an
  arranged order (the Item Catalogue's display order, Roles, Manage apps) opens in that instead.
- Mobile first; the responsive rules (one Main nav reshaped per breakpoint, `<Table stack>`
  with the screen-only `stacked:` container-query variant, 44px touch targets) are in
  `web/AGENTS.md`. The e2e step "phone and tablet: no screen scrolls sideways" fails if
  any screen or table scrolls sideways at 375, 768, 920, 1100, 1280, 1440 or 1920px.
  The screen has no width cap (lists grow with the window); see "Screen width" there.
  Added to a phone's home screen the apps open standalone, as one app (`manifest.json` per language, scope
  `/`, the icon's shortcuts), Account has **Install app**, `public/sw.js` shows an offline screen and caches
  nothing else, and `@ppe/app-shell`'s `AppUpdateNotice` offers Reload when a newer build is deployed
  ("Home-screen app" in `web/AGENTS.md`).
