/**
 * Fetches the community models (src/models.ts) at fixed commits, checks
 * their SHA-256, and writes each gzipped as .models/<lang>.traineddata.gz,
 * as tesseract.js loads them; eng comes from @tesseract.js-data/eng. Our own
 * model (ppe_ocrb) is made by train/. Nothing here is committed.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const out = fileURLToPath(new URL('../.models/', import.meta.url))
mkdirSync(out, { recursive: true })

const remote = [
  {
    lang: 'mrz',
    url: 'https://raw.githubusercontent.com/DoubangoTelecom/tesseractMRZ/0f039b6d18a4a0e7adb0b4841a8732e200b8d968/tessdata_fast/mrz.traineddata',
    sha256: 'ece2a54f125a73792f9cec74e6f8e62f6e5e00c7f19153ba865af689be5b5f01',
  },
  {
    lang: 'ocrb',
    url: 'https://raw.githubusercontent.com/Shreeshrii/tessdata_ocrb/9135a9e9db502db1b3e983da39bc21ba83bbab47/ocrb_int.traineddata',
    sha256: '814f0d862538249d4122db8d41807b08fd7c31181455df7f596a2ed5ce4434ee',
  },
]

for (const m of remote) {
  const target = join(out, `${m.lang}.traineddata.gz`)
  if (existsSync(target)) continue
  const body = Buffer.from(await (await fetch(m.url)).arrayBuffer())
  const sum = createHash('sha256').update(body).digest('hex')
  if (sum !== m.sha256) throw new Error(`${m.lang}: SHA-256 ${sum}, expected ${m.sha256}`)
  writeFileSync(target, gzipSync(body, { level: 9 }))
  console.log(`${m.lang}: ${body.length} bytes, ${readFileSync(target).length} gzipped`)
}

const require = createRequire(import.meta.url)
const eng = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int/eng.traineddata.gz')
writeFileSync(join(out, 'eng.traineddata.gz'), readFileSync(eng))
console.log(`eng: ${readFileSync(eng).length} gzipped`)
