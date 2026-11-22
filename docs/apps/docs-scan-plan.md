# docs-scan: requirements and plan

- **Date:** 2026-11-21
- **Status:** accepted, revision 2 (2026-11-21: **every decision made as recommended**, D1–D11).
  Phase 0 is done: the changes to Personnel files are
  [ADR 0007's amendment of 2026-11-21](../architecture/adr/0007-personnel-files-identity-documents.md#amendment-2026-11-21-scan-documents)
  and "Match" and "Kept scans" in [personnel-service.md](../specs/personnel-service.md), which bind
  where they differ from this plan; the app's words are in the glossary, section 14.
  Revision 1 (the same day) was the proposal.
- **Mockup:** [docs/ux/mockups/docs-scan.html](../ux/mockups/docs-scan.html) (round 1), the screens
  this plan builds.
- **Builds on:** [docs-import plan](docs-import-plan.md) and
  [ADR 0007](../architecture/adr/0007-personnel-files-identity-documents.md) (Personnel files,
  sealed documents, the MRZ read in the browser), [ADR 0005](../architecture/adr/0005-sim-codes-and-scan-sims-trial.md)
  (the device profile), [ADR 0006](../architecture/adr/0006-app-launcher.md) (published apps),
  "Duplicates and merging" in [employee-service.md](../specs/employee-service.md).

## 1. Goal

**Scan Documents** (`docs-scan`) is a phone app, published like Scan SIMs, that:

1. photographs a passport or ID card with the live camera, like the iPhone's Camera app, or reads
   photos already taken;
2. reads the MRZ, and the printed fields the MRZ does not give, in the browser, without AI;
3. **then** finds the person among the employees by a same or similar name, the birth date and the
   document's numbers;
4. updates that employee's record field by field, merges two records of one person first when
   they are found, or adds a new employee;
5. files the document, its Document Copies and the portrait in the person's personnel file, sealed.

Its home is a grid of the user's recent scans, like Photos.

### What is new against Import Documents

Import Documents (`docs-import`) already reads passports and ID cards. It starts by choosing the
person, and then reads. Scan Documents turns that round:

| | Import Documents | Scan Documents |
| --- | --- | --- |
| Order | choose the person, then read | read, then the app finds the person |
| Finding | search by name or code | same or similar name, birth date, personal code, document number |
| Two records of one person | not handled | Merge Employees offered first |
| Printed fields | typed (date of issue, authority, place of birth) | read from the printed text where possible, marked "Printed", correctable |
| Home | a step form | the user's recent scans, as a photo grid |
| Look | the staff app's forms | iPhone Camera and Photos; ui-sdk with shadcn/ui |

The reading itself (`@ppe/mrz/reader`, two reads that agree, the device profile) and the saving
(`POST /personnel/documents`) are Import Documents' and are reused, not rewritten.

## 2. The flow

The screens are the mockup's. Each is one route of the app (`@ppe/routing`), so the phone's back
gesture and a reload work.

| Screen | Route | What it does |
| --- | --- | --- |
| **Scans** | `/` | The user's kept scans (section 5.4), newest first, grouped by day, each a tile with a badge: saved, not saved, MRZ not read. Filter chips All, Not saved, Saved. **Scan Document** opens the camera. |
| **Camera** | `/camera` | Full screen. The document's shape as a guide (ID card or passport, the mode strip). Outlined when found, the MRZ read live, the photo taken by itself once two frames agree (**AUTO**), or by the shutter. A card needs both sides in either order (chips: Back · MRZ, Front · photo). **Photos** reads pictures already taken. **Review** when every side is taken. |
| **Details** | `/scan/:id` | The flattened page, as Photos shows a photo, a filmstrip of the pages, and the details below: the reading's status, the person, the document and the MRZ lines, each field marked with where it came from. A field tapped is corrected. Toolbar: Download Archive, details on/off, Adjust Corners, Delete Scan. **Find Employee** needs the MRZ. |
| **Find Employee** | `/scan/:id/find` | The candidates with **Same name** or **Similar name**, each compared field by field (=, ≈ accents only, ≠, – not on file) with their orders and company assets; **Merge Employees…** when two candidates may be one person; **Choose Another Employee…**; **Add as New Employee**. |
| **Update Employee** | `/scan/:id/update/:employee` | Add to Employee Record; **Take from the document**, field by field (names, birth date, nationality, sex) with the default ticks of D5; what is already the same; the Document Copies; Make a Photo from the Portrait. **Save Document** (and Update). |
| **Merge Employees** | `/scan/:id/merge` | Keep record, then value by value; what moves. Confirmed in an action sheet, then on to Update Employee for the kept record. |
| **Add New Employee** | `/scan/:id/new` | The form filled from the document; Add Employee and Save Document. |
| **Saved** | `/scan/:id/saved` | What was saved and changed; Scan Next Document, Open Employee Page, Back to Scans. |
| **Adjust Corners** | `/scan/:id/adjust/:page` | The photo with the page's 4 corners to drag; Turn Left, Turn Right, Reset. |

## 3. Data, permissions and the record

- **Who uses it:** holders of `personnel.documents.manage`, the built-in **Personnel Documents**
  role (ADR 0007 D7). The tile is `AnyOf personnel.documents.manage`, as Import Documents' is.
- **Finding** needs no other permission. The new match route (section 5.3) is under
  `personnel.documents.manage`, so the role does not also need `employee_profiles.manage`, which
  `/employees/similar` asks for. It answers with each candidate's name, code, birth date,
  nationality and sex, which this role writes in any case, and counts of orders and company assets,
  never what they are.
- **Merging** also needs `employees.merge` (Administrator and Manager). Without it, the banner says
  that the two records may be one person and that a manager can merge them on Employees. The
  document can still go to one of them. The API refuses to remove a record that holds identity
  documents (`ErrMergePersonnel`). The app reads that from the merge preview and offers only the
  record without documents as the one to remove, or explains why the two cannot be merged here.
- **Updating** uses Save's existing `take` (`names`, `birth_date`, `nationality`, `sex`), which
  needs `add_to_employee_record: true` (D4).
- **Adding** uses Save's existing `employee.new` (ADR 0007 D6), all or none with the document.

## 4. Requirements

Priorities: **M** must (v1), **S** should (v1 if possible), **C** could (later).

### 4.1 Functional

| ID | Pri | Requirement |
| --- | --- | --- |
| DS-1 | M | **Scans** lists the user's kept scans with their state (saved, not saved, MRZ not read) and a thumbnail; a tile opens the scan where it was left. Nothing goes to the phone's own photo library. |
| DS-2 | M | **Camera**: live, full screen, the guide in the document's shape; auto-capture once two frames give the same valid lines (Import Documents' FR-4), the shutter for a photo by hand, a card's sides in either order (FR-3), the torch, the camera denied or missing said with Photos still offered. |
| DS-3 | M | **Photos**: up to 10 pictures, each read twice and turned the way its MRZ reads (`readPhoto(…, { turns: true })`); a picture that is not a document is left out with a word why. |
| DS-4 | M | Every page flattened (corners, perspective) as Scan Document does, with **Adjust Corners**, Turn Left and Turn Right. |
| DS-5 | M | **Details** marks each field's source: **MRZ** (check digits right), **MRZ agrees · check the letters** (a name read from the print whose folded letters equal the MRZ's; its accents are the user's to confirm, phase 2), **Printed** (the date of issue, taken by its rule), **Check** (doubtful), **Typed** (corrected). The MRZ lines are shown with the check digits underlined. A wrong check digit, or no MRZ, stops Find Employee, with **Retake** and **Type the MRZ** offered. |
| DS-6 | M | **Find Employee** calls the match route: same-name and similar-name candidates (`employee.CompareNames`), and any employee holding the document's personal code or number (blind index), each with its comparison; at most 5. |
| DS-7 | M | When two candidates are a possible duplicate pair (not marked Not the Same Person), **Merge Employees…** and **Not the Same Person** are offered first, to holders of `employees.merge`. |
| DS-8 | M | **Update Employee** lists only what differs, ticked by D5's rule; Save sends the ticked fields as `take`. |
| DS-9 | M | **Merge Employees**: keep record, values row by row (as the staff app's Merge Employees sheet), the preview's counts, confirmed in an action sheet; then Update Employee for the kept record. |
| DS-10 | M | **Add New Employee**: first and last name (printed, checked against the MRZ), code optional, language; birth date, sex and nationality from the MRZ. |
| DS-11 | M | Save is Import Documents' Save, all or none, with the Document Copies and the portrait; a document already on file, or a personal code on another employee, refused with the API's 409 said in words. |
| DS-12 | M | The scan is linked to the document it was saved as, so its tile turns green and opens read-only (section 5.4). |
| DS-13 | M | **Download Archive** and **Delete Scan** as Scan Document's kept scans (3 days, for their maker alone). |
| DS-14 | S | **Printed fields (VIZ)**, as phase 2 found (`web/spikes/viz`): the names read from the print are **offered, never taken**: prefilled only when they fold to the MRZ's (`@ppe/mrz` `fold`), shown beside the picture of their printed line, and Find Employee waits until the user ticks **I have compared the names with the document** or corrects them (Import Documents' code-lines tick, for names). The date of issue is taken when it lies between birth and expiry, 5 or 10 years before the expiry (a day either way); else typed. Place of birth and authority are typed. Lithuanian model alone (`lit`, 1.9 MB). |
| DS-15 | S | **Make a Photo from the Portrait**, grey, as Import Documents' portrait step. |
| DS-16 | C | Make Colour Photo (AI), as Import Documents (`personnel.portraits.colorize`). |
| DS-17 | C | Several documents in a row without returning to Scans (**Scan Next Document** already opens the camera). |

### 4.2 Non-functional

| ID | Pri | Requirement |
| --- | --- | --- |
| DSN-1 | M | Published app, **device** profile (as Scan SIMs and Import Documents): `'wasm-unsafe-eval'`, `worker-src 'self'`, the camera. No new CSP directive (see DSN-3). |
| DSN-2 | M | **ui-sdk with shadcn/ui** (D9): every component comes from `@ppe/ui`, which wraps ui-sdk where it gives what shadcn/ui on Base UI does not. The app imports neither `@ui-sdk/*` nor `@base-ui/react` directly. |
| DSN-3 | M | ui-sdk adds its behaviour CSS at run time. Under `style-src 'self'` with no nonce it uses constructed stylesheets, which CSP does not block. Phase 1 proves this behind Caddy, and the CSP tests keep it true. If it fails, a nonce or a hash is decided then, not `'unsafe-inline'`. |
| DSN-4 | M | Reading in workers, readers from the app's own files (`readers/`), first use ≤ 6 MB, as docs-import's NFR-2 to NFR-4. |
| DSN-5 | M | EN / LT / RU from typed dictionaries; 44 px targets; safe-area insets; no sideways scroll at the e2e widths; WCAG 2.1 AA, with status texts announced and the corners movable by keyboard. |
| DSN-6 | M | Personal data never in the URL, the log, an audit event, `localStorage` or the device's photo library. Pictures live in memory (`PictureStore`) until sent; the kept scan is the server's, sealed. |
| DSN-7 | M | No ui-sdk agent bridge (`createAgent`, WebMCP) in this app (D10). Fields holding document data are marked `data-agent-secret` all the same. |

## 5. Architecture

### 5.1 Packages

```
web/packages/
  id-docs/      NEW, from docs-import's src/lib: the reading flow without a chosen holder
                (photo slots, draft, names from the MRZ, kind, blockers, save input), make-page,
                page-box, document-geometry, portrait, corners, copies, reader loading; and the
                screens' parts both apps share (live capture, corner editor, portrait crop),
                taking their words as props
  scan-kit/     + useLiveCamera: Scan SIMs' generic camera hook (start and stop, denied, torch,
                eachFrame over the guide, read now, the flash with beep and buzz)
  ui/           + the ui-sdk components (5.2)
  mrz/          unchanged; + the VIZ reader if phase 2 says go (mrz/viz)
web/apps/
  docs-scan/    NEW: make new-app SLUG=docs-scan, then the device profile by hand
  docs-import/  switched to @ppe/id-docs; retired after the trial (D1)
```

`@ppe/id-docs` is extracted first, and docs-import keeps passing its unit and e2e tests on it,
before docs-scan uses it. `flow.ts`'s `Holder` becomes a later step's input: `differences`,
`blockers` and `saveInput` take the holder as an argument, chosen after the reading.

### 5.2 ui-sdk and shadcn/ui together

ui-sdk is installed in `@ppe/ui` (pinned `0.1.0-beta.13`; `web/AGENTS.md`). Its components render
no styles. The rule for the app (D9):

- **shadcn/ui (`@ppe/ui`, Base UI)** where a component already exists: Button, Field and Input,
  Badge, Card, Select, Segmented, Popover, Separator, Skeleton, the states.
- **ui-sdk, wrapped in `@ppe/ui`** where shadcn/ui has nothing that fits a phone app:
  - `drawer.tsx`: the bottom sheet with snap points and swipe to dismiss, and the **action sheet**
    (the Drawer's recipe; Delete Scan, the merge's confirmation, Download Archive);
  - `toast.tsx`: Saved, Deleted, Merged (swipe to dismiss, announced);
  - `filmstrip.tsx` on Carousel's thumbnails: the pages under the photo;
  - `image-cropper.tsx` on Image Cropper: the portrait crop (pinch and keyboard), replacing
    docs-import's own when both apps use `@ppe/id-docs`;
  - `switch.tsx` and `checkbox.tsx` if `@ppe/ui` still lacks them (iOS-like switch, the round tick).
- **Styling:** `@layer ui-sdk;` at the top of `@ppe/ui`'s `styles.css` (above Tailwind). The
  wrappers style ui-sdk's `data-slot` and state attributes with Tailwind (`data-open:…`) from the
  existing tokens. `@ui-sdk/core/web.css` is not loaded; if a part needs its icons or sizes, its
  `--ui-*` tokens are mapped onto ours in `styles.css`, in one place.
- **The viewfinder** is not a ui-sdk component (it has none): it stays custom, on
  `@ppe/scan-kit`'s camera, as in Scan SIMs.
- **Tests** per the ui-sdk skill: every wrapper gets Testing Library tests (Space on a switch,
  focus back after a sheet closes, every sheet button pressed, Cancel included), with
  `__UI_SDK_STRICT__` and the jsdom stubs it lists, and is checked for contrast in a real browser.
- The wrappers are for every app: one Drawer and one Toast in `@ppe/ui`, not one per app.

### 5.3 API

New, under `personnel.documents.manage`, read-only, `no-store`, names in the body never the URL:

```
POST /api/v1/personnel/documents/match
  { mrz: string[], surname: string, given_names: string }
→ { check: DocumentCheck,                      // as /check today
    candidates: [{ employee: { id, full_name, code },
                   kind: "same_name" | "similar_name" | "personal_code" | "document_number",
                   birth_date, nationality, sex,  // the record's, to compare
                   orders: number, assets: number,
                   has_documents: boolean }],
    pairs: [{ a, b, kind }] }                    // candidates that may be one person
```

- In `internal/personnel/document`: the MRZ is parsed again, then candidates come from three
  sources, merged and ranked: `employee.CompareNames` over the folded names (through a port the
  personnel domain declares, adapted in `cmd/api/checkers.go`, as `asset.Mailer` is); the blind
  index of the personal code; the document number's. At most 5.
- `pairs` uses the employees' possible-duplicate rule, minus `employee_distinct_pairs`.
- `routes_test.go` policy entries; `errorStatuses` unchanged (no new sentinel).

Changed:

- `POST /personnel/documents` (Save) takes an optional `scan_id`. The kept scan is then linked to
  the document (5.4), in the same transaction.
- `POST /personnel/scans` also accepts a scan **before** it is read well: `state` `unread` and no
  MRZ, so that Scans can show "MRZ not read" (DS-1). Its meta stays as today (surname, given names,
  kind, number) when read.
- `GET /personnel/scans` adds `state`, `document_id`, `employee_id` and `pages`.
- `GET /personnel/scans/{id}/pages/{n}`: one page's JPEG, for the tile and for reopening a scan;
  the maker's alone, `no-store`, not audited (the archive's download stays audited).

### 5.4 Database (sketch)

Migration `00xx_kept_scan_links`:

- `personnel.scans`: `state text not null default 'read' check (state in ('unread','read','saved'))`,
  `document_id uuid null references personnel.identity_documents`, `employee_id uuid null`, and
  `state = 'saved'` iff `document_id is not null` (CHECK).
- The scan's pages are already sealed under the scan's own key; a page served for a tile is opened
  with it, as the archive is.
- Removing the document, or shredding the person's file, erases a scan linked to it in the same
  transaction (the row, so its key; then the object), as Remove does. The scan expires in 3 days
  anyway.

No new table. `grants.sql`: `ppe_app` may not UPDATE `personnel.scans` today; it gains UPDATE on
the three new columns alone (`state`, `document_id`, `employee_id`), so the sealed values and
`expires_at` stay as written.

### 5.5 Configuration

Nothing new. `API_PERSONNEL_SCAN_DAYS` (3) also sets how long Scans shows a scan.

## 6. Reuse

| From | What |
| --- | --- |
| docs-import `src/lib` | the reading flow, make-page, geometry, portrait, corners, copies, reader loading (moved to `@ppe/id-docs`) |
| docs-import `routes/*` | live capture, corner editor, portrait crop, colour photo (their logic, made into shared parts) |
| Scan SIMs `phone-camera.tsx`, `use-live-scan.ts` | the full-screen modal camera's layout, safe areas, the guide in container units, the status pill, the denied state; the hook's generic half (to `@ppe/scan-kit`) |
| `@ppe/mrz/reader` | photos and live frames, read twice, agreement |
| `@ppe/scan-kit` | camera, `Steady`, `PictureStore`, `Thumb`, `perspective`, reader files |
| API | Check, Save (new employee, take, add to record), kept scans, the merge routes and preview, Not the Same Person |
| The mockup | the screens, the words, the badges |

## 7. Delivery plan

| Phase | Content | Done when |
| --- | --- | --- |
| **0. Decide** | The user confirms D1–D11; ADR 0007 amendment (D4, D8); `personnel-service.md` gains Match and the scan links; the glossary its words (section 10) | decisions recorded. *Done 2026-11-21: every decision as recommended.* |
| **1. Shared parts** | `@ppe/id-docs` from docs-import (docs-import switched to it, unchanged on screen); `useLiveCamera` in `@ppe/scan-kit` (Scan SIMs switched to it); ui-sdk in `@ppe/ui`: `@layer ui-sdk`, Drawer and action sheet, Toast, filmstrip, image cropper, with tests; the CSP proof (DSN-3) | docs-import's and Scan SIMs' unit and e2e tests green on the packages; the ui-sdk wrappers' tests green; one e2e page behind Caddy opens a ui-sdk Drawer with no CSP report *Built 2026-11-21:* `@ppe/id-docs` holds all of docs-import's `src/lib` but its router, `scan.ts` included (`make-page` needs it, and the archive comes to docs-scan, D1); the screen parts stay in docs-import until docs-scan needs them in phase 4, since its camera is Scan SIMs' kind and its cropper ui-sdk's. `useLiveCamera` in `@ppe/scan-kit`, Scan SIMs on it. In `@ppe/ui`: `drawer.tsx` (and the action sheet), `toast.tsx`, `gallery.tsx`, `image-cropper.tsx`, `@layer ui-sdk`. The CSP proof was a spike (`spikes/ui-sdk-csp`), not an e2e page: under the device policy ui-sdk adds no `<style>` only when the page has `<meta property="csp-nonce">`, so every app's `index.html` and the template carry it (DSN-3 answered without a nonce or a hash) |
| **2. VIZ spike** (parallel to 1 and 3) | Read the printed names, dates and personal code on the specimens of `web/e2e/fixtures/documents` and the team's own documents (read locally, never committed): tesseract `lit`+`eng`(+`rus`) in the worker, the zones from the MRZ band's geometry | **Go** if ≥ 95 % of names fold to the MRZ's and 0 % are taken wrong (a fold mismatch is typed, never taken); else DS-14 ships as typed fields with **Check**, as Import Documents *Done 2026-11-21* (`web/spikes/viz`, 224 made-up sides as flattened phone photos): **names no-go** — with `lit` alone at its strictest bar 84 % of surnames and 74 % of given names right, but 16 of 320 taken wrong, each an accent the OCR dropped surely (EGLĖ as EGLE, ŠEŠKEVIČIŪTĖ as SESKEVIČIUTĖ), which neither folding nor confidence can see; `eng` or `rus` added make it worse (72 wrong) and 70 % slower. **Date of issue go**: 77.5 % taken, none wrong. **Place of birth and authority no-go**: the line under the label is the wrong one on a two-column page. About 0.5 s a side on a Mac. DS-14 changed to match; the team's own documents are still to be measured (`pnpm measure -- --pages=.private`) |
| **3. API** | Match, the scan links (migration, Save's `scan_id`, unread scans, pages), policy entries, spec | Go service, Postgres and `cmd/api` HTTP tests (section 8). *Built 2026-11-21:* `document/match.go` with its `People` port (`personnelPeople` in `cmd/api/checkers.go`), migration 0056 and its column grant, Keep's `unread`/`read` and `replaces`, `Page`, Save's `scan_id`, a removed or shredded document erasing its scan; `@ppe/api-client`'s `personnel.match` and `scans.page`; `TestPostgresScanDocumentsHTTP` |
| **4. The app** | `make new-app SLUG=docs-scan NAME='Scan Documents' …`, the device profile by hand (manifest, `csp.test.ts`, Vite's reader files and workers, `VITE_HTTPS`); the screens of section 2 in order: Camera → Details → Find Employee → Update → Saved; then Scans, Merge, Add New, Adjust Corners, Photos, Download Archive; EN/LT/RU; the tile (group `people`, POC, `AnyOf personnel.documents.manage`) | e2e (Vite and Caddy) for the four mockup cases (section 8); no sideways scroll; Help untouched (asked for separately) |
| **5. Printed fields** | DS-14 as phase 2 decided: `src/viz.ts`'s rules into `@ppe/id-docs`, the `lit` model in the app's `readers/`, read in the worker after the MRZ | e2e: the specimen's accented names offered beside their printed line, Find Employee waiting for the names' tick; a date of issue taken |
| **6. Trial** | Preview, then Beta for testers, then Stable; watch Manage apps' Trials (reads, check failures, errors, feedback) | the D1 decision: retire Import Documents' tile (Retired, never deleted) and fold Scan Document's archive into this app |

Phases 1, 2 and 3 can run in parallel; 4 needs 1 and 3; 5 needs 2 and 4.

## 8. Testing

- **Unit (TS):** `@ppe/id-docs` keeps docs-import's tests (`flow`, `portrait`, `corners`,
  `page-box`, `scan`), with the holder chosen later; new rules in `apps/docs-scan/src/lib`: the
  default ticks (D5), the candidates' comparison marks (=, ≈, ≠, –), what Find Employee offers
  (merge first when a pair, Add as New always), the field sources (DS-5), the scan states.
- **ui-sdk wrappers** in `@ppe/ui`: per the skill's testing reference, and contrast checked in a
  browser in both themes.
- **Go:** match service tests with a fake repository (same name, similar name, accents only, a
  personal code on another employee, a distinct pair left out, at most 5, nothing written);
  Postgres tests (the blind index found, deleted and merged employees never offered, the scan link
  and its CHECK, an unread scan); `routes_test.go` (match, pages); `api_postgres_test.go` (match
  then Save with `scan_id`, as `ppe_app`).
- **e2e** (`web/e2e`, behind Caddy under the device policy), one step per mockup case:
  *Scan Documents: an ID card for an employee alike* (photos, Same name, Update with the default
  ticks, saved, the scan green); *a passport for two records alike* (Merge Employees, then Update);
  *a passport for a new person* (Add New Employee); *glare* (the MRZ not read, Type the MRZ, then
  on); and a user with Personnel Documents alone seeing no Merge Employees. Live camera as Import
  Documents' live step (Chromium's fake camera).
- `docs/testing.md` gains the rows; CSP tests for the app (`csp.test.ts`) and the Caddy policy.

## 9. Risks

| Risk | Answer |
| --- | --- |
| ui-sdk is a beta and may change its API | pinned exactly; wrapped in `@ppe/ui`, so a change touches the wrappers only; upgrades deliberate |
| ui-sdk's run-time styles under our CSP | proved in phase 1 (DSN-3) before any screen depends on it |
| Two component systems in one app | D9's rule: one component per job, both behind `@ppe/ui` |
| Printed fields read wrong | phase 2 found the OCR drops accents surely (EGLĖ as EGLE), which folding cannot see: names are offered and compared by the user, never taken; the date of issue only by its rule |
| A wrong person matched | the user always chooses (Use This Employee); a personal code on another employee is refused by Save; Same name and Similar name are a hint, never automatic |
| Merging the wrong records | `employees.merge` only, an action sheet to confirm, the API's preview and its refusal when both hold documents |
| Two apps for one job during the trial | D1: Scan Documents replaces Import Documents after the trial; both share `@ppe/id-docs` meanwhile |

## 10. Words to add to the glossary

Scan Documents (the app); Scans (its home, the kept scans as a grid); Find Employee; Use This
Employee (exists for Add New Employee); Update Employee; Take from the document; Printed, MRZ
agrees, Check, Typed (a field's source); Retake, Type the MRZ; Scan Next Document. EN, LT and RU
labels with them, before the screens use them.

## 11. Decisions

| # | Decision | Decided (2026-11-21, as recommended) |
| --- | --- | --- |
| D1 | Scan Documents beside Import Documents, or replacing it | **Replace it after the trial**: share `@ppe/id-docs` now, retire Import Documents' tile once Scan Documents is Stable |
| D2 | Home: the Scans grid, or straight into the camera | **The grid**, with Scan Document one tap away; the camera opens first when there is no scan |
| D3 | Taking the photo | **Both**: automatic once two frames agree, the shutter by hand; AUTO remembered per device |
| D4 | Add to Employee Record's default (ADR 0007 D1: off) | **On in Scan Documents**, because updating the record is its purpose; off stays Import Documents'. An amendment of D1 |
| D5 | What starts ticked in Take from the document | **What the record lacks, and a name that differs only by accents**; a real difference starts unticked |
| D6 | Merging on the phone | **For `employees.merge` only**; otherwise a banner to ask a manager, and the document can go to one record |
| D7 | Printed fields | **After the phase 2 spike**, taken only when they fold to the MRZ; else typed. *Phase 2 (2026-11-21): names no-go for taking (16 of 320 taken with an accent lost); they are offered to compare (DS-14). Date of issue go. Place and authority typed.* |
| D8 | Where Scans lives | **The server's kept scans** (sealed, 3 days, the maker's alone), linked to the saved document; nothing on the device |
| D9 | ui-sdk and shadcn/ui | **shadcn/ui where `@ppe/ui` has the component; ui-sdk, wrapped in `@ppe/ui`, for the sheet, action sheet, toast, filmstrip and cropper**; the app imports only `@ppe/ui` |
| D10 | ui-sdk's agent bridge | **Not in this app**: it holds identity documents |
| D11 | Make Colour Photo (AI) | **Later** (DS-16); the grey portrait in v1 |
