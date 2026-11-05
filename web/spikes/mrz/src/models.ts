/**
 * The OCR models compared in phase 1 (docs-import plan §5.2 step 4). Each is
 * served at /readers/<lang>.traineddata.gz from .models/ (scripts/fetch-models.ts
 * fetches and checks them; train/ makes ppe_ocrb). Never committed.
 */
export interface Model {
  lang: string
  label: string
  /** Where it comes from, and on what terms. */
  source: string
  licence: string
  /** Whether its licence lets the app ship it. */
  shippable: boolean
}

export const MODELS: Model[] = [
  {
    lang: 'eng',
    label: 'English (tessdata_best int), as Scan SIMs uses',
    source: '@tesseract.js-data/eng 1.0.0, 4.0.0_best_int',
    licence: 'Apache-2.0',
    shippable: true,
  },
  {
    lang: 'mrz',
    label: 'DoubangoTelecom tesseractMRZ, tessdata_fast',
    source: 'github.com/DoubangoTelecom/tesseractMRZ, tessdata_fast/mrz.traineddata (2020-01-05)',
    licence: 'BSD-3-Clause (repository LICENSE); trained on ~7 000 MRZ lines from web images',
    shippable: true,
  },
  {
    lang: 'ocrb',
    label: 'Shreeshrii tessdata_ocrb, ocrb_int',
    source: 'github.com/Shreeshrii/tessdata_ocrb, ocrb_int.traineddata (2019-07-18)',
    licence: 'none stated (all rights reserved): measured for comparison only',
    shippable: false,
  },
  {
    lang: 'ppe_ocrb',
    label: 'Ours: eng fine-tuned with tesstrain on synthetic OCR-B MRZ lines',
    source: 'web/spikes/mrz/train (tessdata_best eng + ocrb10.otf, CTAN ocr-b-outline)',
    licence: 'Apache-2.0 (from eng); the font: "freely use, modify, distribute"',
    shippable: true,
  },
]

/** Everything the OCR may read in an MRZ. */
export const MRZ_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'
