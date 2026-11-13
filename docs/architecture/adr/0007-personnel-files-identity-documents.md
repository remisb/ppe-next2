# ADR 0007: Personnel files, identity documents read in the browser, and AI usage

- **Status:** accepted (decisions made 2026-11-05); being built: the Go MRZ parser
  (`internal/personnel/mrz`) is done, the rest is phase 2 onwards of the
  [docs-import plan](../../apps/docs-import-plan.md)
- **Date:** 2026-11-05
- **Scope:** backend (Go API, Postgres, files store), frontend (`web/apps/docs-import`,
  `@ppe/scan-kit`, `@ppe/mrz`, the staff app's employee page, Administration), deployment
  (`.env.prod`), an outside processor (OpenAI)
- **Builds on:** [ADR 0001](0001-modular-monolith-with-bounded-contexts.md) and the
  [context map](../context-map.md) (Personnel files, People),
  [ADR 0002](0002-permissions-and-administration-app.md) (a permission per action),
  [ADR 0003](0003-audit-integrity-and-retention.md) (the audit trail is permanent),
  [ADR 0005](0005-sim-codes-and-scan-sims-trial.md) (sealed values, Show with a recent
  sign-in, reading in the browser), [ADR 0006](0006-app-launcher.md) (published apps)
- **Spec:** [personnel-service.md](../../specs/personnel-service.md) and
  [ai-usage-service.md](../../specs/ai-usage-service.md)

## Context

The ask: a new app, **docs-import**, takes a passport or ID card with the phone's camera or
from a photo, reads its data, preferably without AI, and saves it to the person's record.
It also makes a colour photo of the person from the document's grey portrait, with AI.

What shapes it:

- **Identity data is special care.** Document numbers and personal codes identify a person
  for life and are what identity fraud needs. The context map already sets them apart: a
  **Personnel files** context, locked down, that nothing else reads.
- **The machine-readable zone can be read deterministically.** The MRZ's lines are printed in
  OCR-B, with check digits over the number and the dates (ICAO Doc 9303). Phase 1 read 97.2 %
  of a deliberately harsh specimen set in the browser with tesseract.js and an OCR-B model,
  with no wrong value accepted, at about 0.4 s a photo. No AI is needed to read.
- **The audit trail and the backups keep everything.** Events are permanent (ADR 0003) and a
  database dump is copied off the server and kept 14 days. Whatever is written in plain text
  is in both, beyond the reach of any later deletion.
- **The law sets how long.** The GDPR keeps personal data no longer than its purpose needs.
  Lithuania's index of retention periods for internal administration documents (in force
  since 2024-10-01, binding on private companies) keeps an employee's personal file 3 years
  after employment ends. The app records no end of employment today.
- **The company chose OpenAI** for the colour photo, with its own API key, and wants every AI
  use accounted for: tokens, cost, when and by whom.

## Decision

1. **A Personnel files context, starting with identity documents.** Package
   `internal/personnel` (its parts: `mrz`, `document`), schema `personnel`. It owns every
   identity field. The employee record (People) keeps the names, and the birth date,
   nationality and sex when a document is added to it (decision 4). Other contexts never read
   Personnel files' tables.

2. **Read in the browser, checked again by the API.** The phone reads the MRZ
   (`@ppe/scan-kit`'s camera, pictures and workers, `@ppe/mrz`'s parser); a live reading is
   taken once every check digit passes in two frames in a row, a photo once two reads agree.
   The API parses the lines again with its Go twin (`internal/personnel/mrz`) and checks every
   digit and the Lithuanian personal code itself. Both parsers are tested on
   `testdata/mrz/vectors.json`, so they cannot drift apart. No server-side reader in v1 (D9).
   v1 reads TD3 passports of any state and TD1 ID cards and residence permits of the EU (D5).

3. **Keep everything the document gives, sealed per person.** Kept: names, birth date,
   nationality, sex, document kind, issuing state, number, personal code, the MRZ, the dates
   of issue and expiry, place of birth, issuing authority, the portrait, and the document's
   own images, **Document Copies** (D2). Kind, issuing state and the dates are plain columns
   (for "valid until" and reminders); everything else is **sealed** with the person's own
   **data key** (`sealbox`, AES-256-GCM): the fields in the document's row, the portrait and
   copies as objects in the files store. Each data key is sealed by the master keyring
   `API_PERSONNEL_KEY` (with `…_KEY_ID` and `…_PREVIOUS_KEYS`, re-sealed by
   `api -reseal-personnel-keys`) and kept in `personnel.subject_keys`. Lookups ("this person or
   document is already on file") use **blind indexes**, HMAC-SHA256 under
   `API_PERSONNEL_INDEX_KEY`, of the number and the personal code. A copy is re-encoded on the
   phone before Save (at most 2400 px, JPEG), so the camera's metadata, location included,
   never leaves it.

4. **Add to Employee Record, chosen per document (D1).** The scan's review step has a switch,
   off by default, saved with the document. On, the birth date, nationality and sex are offered
   for the employee's own columns, and the employee page's **Identity** section shows that
   document's fields, read through Personnel files' API, never copied. Off, the document is
   filed only and the page says "ID card · LTU · valid until …". The number, personal code and
   copies are never written into `employees`, switch or not. Who sees what on the employee page
   (D11): kind, state, dates, place of birth and authority to holders of a personnel
   permission; the number, personal code and copies only through **Show Document**. This is
   the one place another screen reads Personnel files, and the context map records it.

5. **Kept for employment and 3 years after, then shredded (D3).** The period is a setting,
   `API_PERSONNEL_RETENTION_MONTHS` (36), as the law has changed before (50, 10, now 3 years).
   Personnel files records when employment ended (`personnel.subjects.employment_ended_on`,
   **Mark Employment Ended**, audited, undoable; deleting an employee sets it). A daily job
   applies the rule: it deletes the person's data key, which makes every field, portrait and
   copy unreadable at once, removes their objects, and clears their AI usage rows' employee
   link. It is a rule, not an action, so after a restore it shreds again. A **Legal Hold**
   (date and reason, audited) stops it. The Overview lists, 30 days ahead, whose documents will
   go. **Erasure means** (D10): unreadable at once in the live database and files store, and
   everywhere once the last backup holding the key has expired (14 days today); the DPIA and
   every answer to an erasure request say so. Superseded documents stay in the file until it
   goes.

6. **Its own permissions and role (D6, D7).** `personnel.documents.manage` (scan, save, Mark
   Employment Ended, Legal Hold; may create and change employees, as no employee permission
   exists), `personnel.documents.read` (Show Document), `personnel.portraits.colorize` (AI
   colour). A new built-in role, **Personnel Documents**, holds the first two; administrators
   do not get it by default, as with Equipment Assignments. Show Document follows Show PIN and
   PUK: a recent sign-in, the event `personnel.document_shown` recorded before the answer,
   `no-store`, hidden again after 60 s. Reads of the sealed fields are audited (the context
   map's "read events"); no event, error or log line ever holds a number, code or image.

7. **AI colour by OpenAI, under a luminance lock (D4).** The API sends only the grey portrait
   with a fixed prompt to OpenAI's image edit endpoint (model a setting, `gpt-image-2`), then
   keeps only the colour of the answer: the document's lightness channel (CIELAB L) with the
   model's a\*b\*, so the face's every edge is the document's and the model cannot redraw it.
   Before and after are shown; the person's consent is recorded with the photo; the photo is
   labelled AI-coloured everywhere and refused for the ID badge use. OpenAI is a processor:
   its DPA, the transfer covered in the DPIA, Zero Data Retention or EU residency if the account
   qualifies.

8. **The OpenAI key in Settings; every AI call in a ledger.** An administrator enters the key
   in Administration's Settings (`settings.manage`, a recent sign-in). The API seals it with a
   new keyring, `API_SECRETS_KEY`, and never returns it. **AI usage** is a small platform area,
   `internal/aiusage`, through which every AI call goes: one row per call with the business
   operation, model, tokens by kind, the cost from the price table in force (kept on the row),
   when, who, app, request, employee and outcome, never the prompt, image or answer. A monthly
   budget refuses calls once spent. Administration's **AI Usage** screen (`ai_usage.read`)
   shows and exports it.

9. **docs-import is a published trial app (D8).** `web/apps/docs-import`, the `device` profile,
   at `/apps/docs-import/`, reporting as `docs-import`. It may create employees (D6). Whether it
   merges into the staff app is decided after the trial, as with Scan SIMs.

## Consequences

- **Three more keys to keep offline.** `API_PERSONNEL_KEY`, `API_PERSONNEL_INDEX_KEY` and
  `API_SECRETS_KEY` join `API_SIM_CODES_KEY`: a restore needs each, `docs/backups.md` says how
  to keep and change them. Losing `API_PERSONNEL_KEY` loses every document; losing the index key
  loses only the lookups (they can be computed again from the opened values).
- **Copies of ID documents are a legal exposure.** Lithuania's data protection inspectorate
  treats keeping them as excessive unless a purpose needs it. A DPIA naming the purpose and
  legal basis is done before go-live, and employees are told. If the DPO finds no basis, copies
  are switched off and the fields stay.
- **The backups hold sealed data for 14 days after a shredding.** Accepted and stated; a
  stronger form (keys outside the database) is possible later if the DPO requires it.
- **The employee page reads another context.** An accepted exception, gated by permission and
  per document; the rest of the map's isolation holds.
- **An outside processor sees faces, and costs money.** Mitigated by sending only the grey
  portrait with no name, consent, the luminance lock, the budget and the ledger. OpenAI can
  retire a model or change prices: both are settings.
- **The app records when employment ended** for the first time. When an HR context exists
  (ADR 0001), it owns that date and Personnel files reads it.
- **Phase 1 is a specimen result.** Phones and the team's own documents are still to be
  measured before the trial; a poor result there reopens D9.

## Alternatives considered

- **Identity fields as columns on `employees`.** Simplest, but they would be in plain text in
  every list, export and backup, outside any per-person key, and visible to every signed-in
  user (any of them opens the employee page). Rejected (D1).
- **A Settings-wide switch to show identity data on employee records.** Replaced by the
  per-document choice, which the person scanning makes knowingly each time (D1).
- **Reading on the server.** The same pixels read no better there (phase 1's failures were
  small and blurred photos), and the image would leave the phone. Not in v1 (D9).
- **A self-hosted colouring model.** Keeps faces on our server, but needs a sidecar and memory
  the droplet lacks; the company chose OpenAI (D4). The luminance lock is kept either way.
- **Keeping no copies, only the fields.** The data-minimising default the plan proposed;
  the company keeps them (D2), with the DPIA as the condition.

## Amendment (2026-11-13): kept scans

Import Documents gets a second mode, **Scan Document**: one person's passport or ID card photos
are flattened in the browser (a perspective transform), read for the MRZ, and either saved to the
Personnel file through the existing flow or downloaded as a zip named after the person and the
document's kind. So that nobody does that work twice, the API keeps the zip for a short time.

- **Kept for `API_PERSONNEL_SCAN_DAYS` (3) days, for the uploader alone.** Another user, an
  administrator included, never lists, downloads or removes it (404, as if it were not there).
  After the period the upkeep erases it; the uploader may Remove it earlier.
- **Sealed under a key of its own.** Each scan has a fresh data key, sealed by the master keyring
  `API_PERSONNEL_KEY` and bound to the scan's id. The zip (in the files store, `personnel-scans/{id}`)
  and what names it (the names, the kind and number, the file name) are sealed with it; the row
  holds the plain zip's size and SHA-256, checked on opening. Deleting the row is the erasure, a
  hard delete as the shredding is: an object a versioned bucket still keeps never opens again.
- **No name leaves the sealed values except as the download's file name**, in `Content-Disposition`
  alone: never in a URL, a log line or an audit event. The events (`personnel.scan_kept`,
  `personnel.scan_downloaded`, `personnel.scan_removed`) carry the scan's id and page count.
- **Not tied to an employee.** A scan is the uploader's work in progress, not a Personnel file;
  it is not on the employee's Changes, and the shredding does not look for it (it is gone within
  days anyway).
- **An exception to the docs-import plan's PR-1**, which keeps images in the screen's memory
  until Save: a downloaded scan's pages leave the screen for the server, sealed, for these days.
  The Save to Personnel ending still follows PR-1.

The same permission as Save (`personnel.documents.manage`) covers it, and without Personnel
files' keys it answers 503 like Save. The DPIA (Consequences) covers the kept scans too: the
purpose is not redoing the scanning, the period is days. Rules in
[personnel-service.md](../../specs/personnel-service.md), "Kept scans".
