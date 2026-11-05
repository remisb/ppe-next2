/**
 * Ground truth for training ppe_ocrb (docs-import plan §5.2 step 4, the
 * tesstrain option): made-up MRZ lines of every format, drawn in OCR-B
 * (web/e2e/fixtures/documents/ocrb10.otf) at the ICAO pitch, roughed up as a
 * phone photo would (size, blur, a guilloche behind, noise, a slight turn,
 * uneven light) and thresholded with the spike's own Sauvola (src/image.ts)
 * at the height the reader cuts bands at, so the model learns what it will
 * be shown. Writes train/work/gt/<n>.png and <n>.gt.txt.
 *
 *   node --experimental-strip-types train/lines.ts [count]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

import { checkDigitOf } from '@ppe/mrz'

const count = Number(process.argv[2] ?? 6000)
const out = fileURLToPath(new URL('./work/gt/', import.meta.url))
mkdirSync(out, { recursive: true })

let seed = 20261105
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
const pick = <T,>(xs: ArrayLike<T>) => xs[Math.floor(rnd() * xs.length)]!
const int = (n: number) => Math.floor(rnd() * n)
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const D = '0123456789'
const SYLLABLES = ['AN', 'NA', 'JO', 'NAS', 'PET', 'RAS', 'MIG', 'LE', 'EG', 'ZU', 'KAU', 'SKAI', 'TE', 'VI', 'DAS', 'MUL', 'LER', 'ER', 'IK', 'SSON', 'BAN', 'DO', 'MO', 'JI', 'KO', 'VAL', 'SKI', 'OV', 'IEN', 'AI', 'TIS', 'GRI', 'GO', 'RII', 'ZH', 'SH', 'CHUK', 'IN', 'A', 'O', 'E', 'U', 'Y', 'Q', 'X', 'W', 'F', 'H']
const STATES = ['LTU', 'LVA', 'EST', 'POL', 'D<<', 'UKR', 'BLR', 'RUS', 'GBR', 'FRA', 'NLD', 'SWE', 'FIN', 'UTO', 'ITA', 'ESP', 'ROU', 'BGR', 'GEO', 'MDA']
const pad = (s: string, n: number) => s.padEnd(n, '<').slice(0, n)
const word = () => Array.from({ length: 1 + int(3) }, () => pick(SYLLABLES)).join('')
const name = (n: number) => pad(`${word()}${rnd() < 0.3 ? `<${word()}` : ''}<<${word()}${rnd() < 0.4 ? `<${word()}` : ''}`, n)
const number = () => (rnd() < 0.4 ? Array.from({ length: 8 + int(2) }, () => pick(D)).join('') : Array.from({ length: 9 }, () => pick(rnd() < 0.35 ? A : D)).join(''))
const date = () => `${String(int(100)).padStart(2, '0')}${String(1 + int(12)).padStart(2, '0')}${String(1 + int(28)).padStart(2, '0')}`
const optional = (n: number) => (rnd() < 0.5 ? pad('', n) : pad(Array.from({ length: 1 + int(n) }, () => pick(rnd() < 0.7 ? D : A)).join(''), n))

/** One made-up document's MRZ lines, check digits right. */
function mrz(): string[] {
  const f = pick(['TD1', 'TD1', 'TD3', 'TD3', 'TD2'] as const)
  const state = pick(STATES)
  const nat = pick(STATES)
  const sex = pick(['M', 'F', '<'])
  const n = pad(number(), 9)
  const b = date()
  const e = date()
  if (f === 'TD1') {
    const l1 = pad(pick(['I<', 'ID', 'IR', 'AC']) + state + n + checkDigitOf(n) + optional(15), 30)
    const a = b + checkDigitOf(b) + sex + e + checkDigitOf(e) + nat + optional(11)
    return [l1, a + checkDigitOf(l1.slice(5, 30) + a.slice(0, 7) + a.slice(8, 15) + a.slice(18, 29)), name(30)]
  }
  const len = f === 'TD3' ? 44 : 36
  const opt = optional(f === 'TD3' ? 14 : 7)
  const tail = f === 'TD3' ? opt + (/^<+$/.test(opt) ? '<' : checkDigitOf(opt)) : opt
  const a = n + checkDigitOf(n) + nat + b + checkDigitOf(b) + sex + e + checkDigitOf(e) + tail
  const comp = f === 'TD3' ? a.slice(0, 10) + a.slice(13, 20) + a.slice(21, 43) : a.slice(0, 10) + a.slice(13, 20) + a.slice(21, 35)
  return [pad((f === 'TD3' ? 'P<' : pick(['I<', 'A<', 'C<'])) + state + name(len), len), a + checkDigitOf(comp)]
}

const lines: string[] = []
while (lines.length < count) lines.push(...mrz())
lines.length = count

// The page: OCR-B, and Sauvola from src/image.ts, the very code the reader runs.
const font = readFileSync(new URL('../../../e2e/fixtures/documents/ocrb10.otf', import.meta.url)).toString('base64')
const image = stripTypeScriptTypes(readFileSync(new URL('../src/image.ts', import.meta.url), 'utf8')).replace(/^export /gm, '')

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(`<style>@font-face { font-family: OCRB; src: url(data:font/otf;base64,${font}) }</style><span style="font-family:OCRB">0</span>`)
await page.addScriptTag({ content: `${image}\nwindow.sauvola = sauvola;` })
await page.evaluate(() => document.fonts.ready)

interface Job {
  text: string
  rough: { blur: number; noise: number; turn: number; light: number; guilloche: boolean; height: number; ink: number; jpeg: number }
}

const BATCH = 50
for (let i = 0; i < lines.length; i += BATCH) {
  const jobs: Job[] = lines.slice(i, i + BATCH).map((text) => ({
    text,
    rough: {
      blur: rnd() < 0.5 ? rnd() * 1.6 : 0,
      noise: rnd() * 28,
      turn: (rnd() - 0.5) * 1.6,
      light: rnd() * 0.5,
      guilloche: rnd() < 0.7,
      // Bands are cut at 32 px a character; the rows found vary a little.
      height: 26 + rnd() * 14,
      ink: 10 + rnd() * 60,
      jpeg: 0.5 + rnd() * 0.45,
    },
  }))
  const pngs = await page.evaluate(async (jobs: Job[]) => {
    const w = window as unknown as { sauvola: (g: { width: number; height: number; data: Uint8Array }, win: number, k: number) => Uint8Array }
    const results: string[] = []
    for (const { text, rough } of jobs) {
      // Drawn at 3× the target, then scaled down, as a camera's picture is.
      const big = rough.height * 3
      const pitch = big * 1.06
      const W = Math.ceil(pitch * text.length + big * 2.4)
      const H = Math.ceil(big * 2.2)
      const c = new OffscreenCanvas(W, H)
      const g = c.getContext('2d')!
      const paper = 225 + Math.random() * 25
      g.fillStyle = `rgb(${paper},${paper - 4},${paper - 10})`
      g.fillRect(0, 0, W, H)
      if (rough.guilloche) {
        g.strokeStyle = `hsla(${Math.random() * 360},45%,62%,0.6)`
        g.lineWidth = Math.max(1, big / 40)
        for (let k = 0; k < 8; k++) {
          g.beginPath()
          for (let x = 0; x <= W; x += 4) g.lineTo(x, H / 2 + (H / 2.2) * Math.sin(x / (big * (0.4 + k / 10)) + k))
          g.stroke()
        }
      }
      g.save()
      g.translate(W / 2, H / 2)
      g.rotate((rough.turn * Math.PI) / 180)
      g.fillStyle = `rgb(${rough.ink},${rough.ink},${rough.ink + 6})`
      // OCR-B's capitals are ~0.67 em tall: a font size of 1.5 × the wanted height.
      g.font = `${big * 1.5}px OCRB`
      g.textBaseline = 'middle'
      for (let k = 0; k < text.length; k++) {
        const ch = text[k]!
        const m = g.measureText(ch)
        g.fillText(ch, -((pitch * text.length) / 2) + k * pitch + (pitch - m.width) / 2, 0)
      }
      g.restore()
      // Uneven light: a gradient across the line.
      const grad = g.createLinearGradient(0, 0, W, 0)
      grad.addColorStop(0, `rgba(255,255,255,${rough.light})`)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, W, H)
      // Down to the band's scale, blurred.
      const s = new OffscreenCanvas(Math.round(W / 3), Math.round(H / 3))
      const sg = s.getContext('2d')!
      // Paper first: a blur would draw the transparent edges in as a dark frame.
      sg.fillStyle = `rgb(${paper},${paper - 4},${paper - 10})`
      sg.fillRect(0, 0, s.width, s.height)
      sg.filter = rough.blur ? `blur(${rough.blur}px)` : 'none'
      sg.drawImage(c, 0, 0, s.width, s.height)
      // JPEG's blocks, then noise.
      const jpg = await createImageBitmap(await s.convertToBlob({ type: 'image/jpeg', quality: rough.jpeg }))
      sg.filter = 'none'
      sg.drawImage(jpg, 0, 0)
      const px = sg.getImageData(0, 0, s.width, s.height)
      const grey = new Uint8Array(s.width * s.height)
      for (let p = 0; p < grey.length; p++) {
        const v = (px.data[p * 4]! * 77 + px.data[p * 4 + 1]! * 150 + px.data[p * 4 + 2]! * 29) >> 8
        grey[p] = Math.max(0, Math.min(255, v + (Math.random() - 0.5) * rough.noise))
      }
      const ink = w.sauvola({ width: s.width, height: s.height, data: grey }, Math.round(rough.height) * 2 + 1, 0.25)
      for (let p = 0; p < grey.length; p++) {
        const v = ink[p] ? 0 : 255
        px.data[p * 4] = px.data[p * 4 + 1] = px.data[p * 4 + 2] = v
      }
      sg.putImageData(px, 0, 0)
      const blob = await s.convertToBlob({ type: 'image/png' })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (const b of bytes) bin += String.fromCharCode(b)
      results.push(btoa(bin))
    }
    return results
  }, jobs)
  pngs.forEach((b64, k) => {
    const n = String(i + k).padStart(5, '0')
    writeFileSync(`${out}${n}.png`, Buffer.from(b64, 'base64'))
    writeFileSync(`${out}${n}.gt.txt`, `${jobs[k]!.text}\n`)
  })
  if (i % 1000 === 0) console.log(`${i + jobs.length} / ${lines.length}`)
}
await browser.close()
