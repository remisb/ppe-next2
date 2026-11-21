# Printed fields (VIZ) spike (docs-scan, phase 2)

Throwaway. It answers the plan's question for DS-14: can the browser read a document's printed
names (with their accents), date of issue, place of birth and authority well enough to take them
([docs/apps/docs-scan-plan.md](../../../docs/apps/docs-scan-plan.md), phase 2). It is not an app:
nothing builds it into an image. What lasts is the verdict in the plan and, for phase 5,
`src/viz.ts`'s rules.

```bash
export PATH=~/.cache/node/corepack/v1/pnpm/12.6.0:$PATH   # on this Mac (the corepack shim is broken)
cd web/spikes/viz
pnpm models          # eng, lit and rus (tessdata_best int, Apache-2.0) into .models/
pnpm pages           # 224 sides into .pages/: made-up documents as flattened phone photos
pnpm measure         # every language set; --langs=lit --bars=0,90,97 for fewer
pnpm test            # the rules on hand-made OCR lines
node --experimental-strip-types scripts/peek.ts lit id-lt-front-0.jpg   # what the OCR read on a side
```

**Your own documents.** Put flattened, upright photos of a side in `.private/` (never committed)
with an `index.json` of the same shape as `.pages/index.json` (each side's MRZ lines and what it
prints), then `pnpm measure -- --pages=.private`. Only counts are printed, never a value.

| Path | What |
| --- | --- |
| `src/specimens.ts` | the e2e specimens with dates of issue, places of birth and authorities, and four more (many accents, a bilingual Cyrillic and Latin passport, names the MRZ cuts short, a plain name) |
| `src/viz.ts` | the rules: a name taken only when it folds to the MRZ's and every markable letter was read surely; the date of issue between birth and expiry, 5 or 10 years before it; place and authority under their labels |
| `scripts/pages.ts` | the sides drawn upright and roughened (blur, light, glare, dimness, noise, JPEG, a small turn, low resolution) |
| `scripts/measure.ts` | the OCR (tesseract.js 7 in Node, the engine the browser runs), the rules, the counts |

## Results (2026-11-21, 224 sides, 160 of each field)

Lithuanian alone, its strictest bar (each markable letter read at 97 or more):

| Field | Taken, right | Taken, wrong | To check, right | To check, wrong | Missed |
| --- | --- | --- | --- | --- | --- |
| Surname | 84.4 % | 2 | 0.6 % | 5 | 10.6 % |
| Given names | 73.8 % | 14 | 0.6 % | 3 | 15.0 % |
| Date of issue | 77.5 % | **0** | — | 0 | 22.5 % |
| Place of birth | — | — | 0 % | 77 | 51.9 % |
| Authority | — | — | 0 % | 77 | 51.9 % |

- **Every name taken wrong lost an accent the OCR read surely**: EGLĖ as EGLE, MIGLĖ as MIGLE,
  ŠEŠKEVIČIŪTĖ as SESKEVIČIUTĖ. Folding cannot see it (both fold to the MRZ's letters), and no
  confidence bar separates them: at 97 the surnames fall to 2 wrong and the given names stay at 14.
- **English or Russian added make it worse**: lit+eng 32 and 46 names wrong, lit+eng+rus 28 and 44,
  English explaining an unmarked letter better. And slower: 0.50 s a side for lit, 0.84 s for
  lit+eng+rus, on this Mac with 6 workers (a phone several times that).
- **Date of issue**: the rule (a printed date between birth and expiry, 5 or 10 years before the
  expiry, a day either way) took none wrong. The misses are sides whose date the OCR did not read.
- **Place of birth and authority**: the line under the label is the wrong line on a two-column
  passport page (UTENA MIGRACIJOS) and cuts a value that wraps (MIGRACIJOS / DEPARTAMENTAS).
- tesseract.js's `rectangle` read these pages as noise; the whole side, its MRZ lines dropped,
  reads well. The app crops its own canvas in any case.

**Verdict:** names **no-go** for taking them unchecked (the gate: 95 % right and none wrong);
offered as read, to check, they save typing about four times in five. Date of issue **go**.
Place of birth and authority **no-go**, typed. The documents are synthetic (a sans font on drawn
security printing); the team's own documents were not measured here.
