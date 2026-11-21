/** Prints what the OCR read on a few pages: `peek.ts <langs> <file>...` (debugging the spike). */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createWorker, OEM } from 'tesseract.js'

const [langs = 'lit+eng', ...files] = process.argv.slice(2)
const dir = fileURLToPath(new URL('../.pages/', import.meta.url))
const worker = await createWorker(langs.split('+'), OEM.LSTM_ONLY, { langPath: fileURLToPath(new URL('../.models', import.meta.url)), cachePath: join(tmpdir(), 'ppe-viz-spike'), gzip: true })
for (const f of files) {
  const { data } = await worker.recognize(join(dir, f), {}, { blocks: true })
  console.log(`== ${f}`)
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) console.log('  ' + l.words.map((w) => `${w.text}(${Math.round(w.confidence)})`).join(' '))
}
await worker.terminate()
