/**
 * Puts the three models (tessdata_best int, Apache-2.0, from the @tesseract.js-data
 * packages) where tesseract.js reads them: .models/<lang>.traineddata.gz. Never committed.
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = fileURLToPath(new URL('../.models/', import.meta.url))
mkdirSync(out, { recursive: true })
const require = createRequire(import.meta.url)
for (const lang of ['eng', 'lit', 'rus']) {
  const from = join(dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), `4.0.0_best_int/${lang}.traineddata.gz`)
  copyFileSync(from, join(out, `${lang}.traineddata.gz`))
  console.log(`${lang}: ${statSync(from).size} bytes gzipped`)
}
