# ADR 0005: SIM cards' PIN and PUK sealed by the app, and Scan SIMs as a trial app

- **Status:** accepted (built 2026-10-29)
- **Date:** 2026-10-29
- **Scope:** backend (Go API, Postgres), frontend (`web/apps/sim-scan`, `web/packages/sim-scan`), deployment (Caddy, `.env.prod`)
- **Builds on:** [ADR 0002](0002-permissions-and-administration-app.md) (a permission per
  action, a second app on the same origin), [ADR 0003](0003-audit-integrity-and-retention.md)
  (the audit trail is permanent and sealed), [ADR 0004](0004-company-assets.md)

## Context

SIM cards arrive by the dozen on plastic carriers. The front has the SIM No. (an ICCID,
19 digits, Luhn-checked) as a Code 128 barcode, beside the product code (EAN-13, the same on
every card). The back has the PIN, the PUK and the provider's customer service number, and
no SIM No. Typing the 19 digits of each card into Add SIM is where register mistakes come
from. The PIN and PUK were not kept anywhere, but they are needed when a phone locks.

The ask was to read the carriers in batches, with the phone's camera or from photos, and
add the cards at once. The PIN and PUK are kept, but guarded: hidden until someone allowed
asks, each time recorded. The reading happens in the browser, so no card data leaves the
company's systems. The work is tried first as a separate app, then merged into the staff
app beside SIM Cards if it works well.

Three constraints shape this:

- **The policy refuses WebAssembly.** The apps' Content-Security-Policy allows nothing but
  their own files and no WebAssembly. Reading a barcode reliably on iPhones (Safari has no
  `BarcodeDetector`) and reading printed digits both need WebAssembly libraries.
- **The audit trail keeps everything forever.** Events are permanent, sealed (ADR 0003) and
  readable by anyone who can see an asset's Changes. A code written into one can never be
  taken out.
- **Backups are wide copies.** A database dump is copied off the server, and a restore
  drill opens it monthly. A secret in plain text would be in every one of them.

## Decision

1. **The API seals the codes; the database never holds the key.** PIN and PUK are sealed
   together, with AES-256-GCM, under `API_SIM_CODES_KEY` (`internal/sealbox`), bound to the
   card's id. They are stored in a table of their own, `asset_sim_codes` (migration 0041), so
   `Asset`, its JSON and every asset query stay as they were. The key is a required setting,
   kept like the backup's age key: apart from the backups, offline. Each row records its
   `key_id`, so a later key can be brought in.
2. **Showing is its own permission and its own event.** `sim_codes.read` requires
   `assets.manage` and is installed for the Administrator alone. Each Show checks the
   user's roles as they are now and needs a recent sign-in (as managing users does). It
   records `asset.sim_codes_shown` before answering, and the answer is `no-store`. Setting
   and clearing the codes records `asset.sim_codes_changed`. No event, error or log line
   ever holds the codes.
3. **Reading happens in the browser, from the app's own files.** zxing-wasm reads the
   barcode and tesseract.js (English data, digits and the letters of PIN and PUK) reads the
   back. The PIN and PUK are placed by their words' boxes, next to their labels. Their
   files are served under `/sim-scan/readers/` (`@ppe/sim-scan/reader-files`), never from a
   CDN, and load only once a card is scanned. What was read reaches the API only as the
   batch the user adds.
4. **A trial app, `/sim-scan/`, with its own policy.** It is a third app on the staff app's
   origin and sign-in. Its policy is the staff app's plus `'wasm-unsafe-eval'` (compiling
   WebAssembly, still no `eval`) and `worker-src 'self'`. It alone may use the camera. The
   staff app and Administration keep their policy unchanged, and tests pin both. The trial
   reports as `workwear`, so the audit sources and Usage need no new app.
5. **Built to merge.** The rules, readers, wording and review list are in the package
   `@ppe/sim-scan`, and the API is final. When the trial passes:
   - The staff app gains Scan SIMs beside Add SIM, and Show PIN and PUK on a SIM's page.
   - Its policy takes the two additions.
   - The trial app, its Caddy handle and its policy line go.
6. **One card, one SIM No.** A 20-character ICCID ends in the filler F, which a barcode may
   leave out. The unique index and every comparison now ignore it, so a scanned `…5` is
   seen as the register's `…5F`.

## Consequences

- **Losing the key loses the codes.** A restore needs the same key. Without it every Show
  fails, though the cards' carriers still have the codes and Add PIN and PUK keeps them
  again. There is no key rotation yet.
- **A deploy needs the new setting.** The API does not start without
  `API_SIM_CODES_KEY`, so `.env.prod` gets it before the first `make prod-up` of this
  version.
- **The trial page is the weakest point.** One page is allowed to compile WebAssembly. An
  injected script there could do more than elsewhere, though still only with the app's
  own files and origin.
- **The text reader is about 5 MB on first use.** That is the core and its English data,
  which the browser keeps afterwards.
- **The camera needs https.** On a phone in development that means
  `VITE_HTTPS=1 pnpm --dir apps/sim-scan dev`, or staging.
- **Card photos are never committed.** The real ones hold real codes. The e2e step reads
  synthetic carriers with made-up numbers (`web/e2e/fixtures/sim-cards`).
