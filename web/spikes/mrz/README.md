# MRZ reading spike (docs-import, phase 1)

Throwaway. It answers the plan's go / no-go question, whether a browser reads passports' and ID
cards' MRZ well enough ([docs/apps/docs-import-plan.md](../../../docs/apps/docs-import-plan.md),
"Phase 1 results"). It is not an app: nothing builds it into an image (`web/.dockerignore`),
and it goes once docs-import exists. What lasts is `@ppe/mrz`, `testdata/mrz/vectors.json`, the
specimen documents (`web/e2e/fixtures/documents`), and `src/image.ts`, which moves to
`@ppe/scan-kit` in phase 3.

```bash
export PATH=~/.cache/node/corepack/v1/pnpm/12.6.0:$PATH   # on this Mac (the corepack shim is broken)
cd web/spikes/mrz
pnpm models          # the community models, checked by SHA-256, into .models/
pnpm photos          # the test set: specimen photos and live frames into .photos/
pnpm measure -- --second                 # every model, in Chromium and WebKit
pnpm measure -- mrz --browsers=chromium  # one model, one browser
pnpm simulate        # what check digits catch, on random misreads (no images)
pnpm test            # the image operations on drawn pictures
pnpm dev             # the page at http://localhost:5189 (pnpm dev --host: on the LAN)
```

Our own model, `ppe_ocrb` (`eng` fine-tuned on synthetic OCR-B lines), needs Docker:

```bash
node --experimental-strip-types train/lines.ts 8000   # ground truth into train/work/gt
MAX_ITERATIONS=6000 ./train/train.sh                  # tesstrain in Docker, into .models/
```

**On a phone.** `pnpm photos`, then `pnpm dev --host`, and open `http://<this machine>:5189` on
the phone: **Run the specimen photos** reads the whole set with the chosen model and shows the
read rate, wrong values accepted, time a photo and the browser. Choosing a photo of a real
document reads it on the phone and shows only whether it was accepted, its corrections and
problems and the time; its lines stay hidden unless asked for, and nothing is kept or sent.
Record counts only. (The camera needs https; a chosen photo does not.)

| Path | What |
| --- | --- |
| `src/image.ts` | grey, Sauvola, skew, the MRZ band, the cut-out (pure, on pixels) |
| `src/image.worker.ts`, `image-protocol.ts` | the image work in a worker, pixels transferred |
| `src/ocr.ts` | `createTextReader({ lang, base, whitelist, psm })`, the factory plan §6 asks for |
| `src/reader.ts` | photo or live strip → band → OCR → `readMrz`, timed |
| `src/models.ts` | the models compared and their licences |
| `scripts/` | fetching models, making photos, measuring, the simulation |
| `train/` | ground-truth lines and the tesstrain run |
