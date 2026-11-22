/**
 * The test set: each side of each made-up document (src/specimens.ts) drawn as the app's
 * page making leaves it (upright, the document filling the picture, @ppe/id-docs
 * make-page), with a phone photo's troubles left over in a seeded mix: blur, uneven light,
 * glare, dimness, noise and JPEG, a turn of a degree or two, a low resolution. Writes
 * .pages/*.jpg and .pages/index.json with what each side prints.
 *
 *   node --experimental-strip-types scripts/pages.ts [variants per side, 16]
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

import { mrzOf, styles, truthOf, vizDocuments, vizSideHtml, type SideTruth } from '../src/specimens.ts'

const variants = Number(process.argv[2] ?? 16)
const out = fileURLToPath(new URL('../.pages/', import.meta.url))
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

let seed = 4417
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
const between = (a: number, b: number) => a + rnd() * (b - a)
const MM = 96 / 25.4

export interface Trouble {
  width: number
  turn: number
  blur: number
  light: number
  dim: number
  noise: number
  jpeg: number
  glare: boolean
}

function trouble(i: number, full: number): Trouble {
  const t: Trouble = { width: full, turn: 0, blur: 0, light: 0, dim: 1, noise: 0, jpeg: 0.9, glare: false }
  if (i === 0) return t
  for (const k of ['turn', 'blur', 'light', 'small', 'noise', 'glare', 'dim'].filter(() => rnd() < 0.45)) {
    if (k === 'turn') t.turn = between(0.5, 2) * (rnd() < 0.5 ? -1 : 1)
    if (k === 'blur') t.blur = between(0.4, 1.4)
    if (k === 'light') t.light = between(0.2, 0.5)
    if (k === 'small') t.width = Math.round(full * between(0.5, 0.7))
    if (k === 'noise') (t.noise = between(0.06, 0.18)), (t.jpeg = between(0.55, 0.75))
    if (k === 'glare') t.glare = true
    if (k === 'dim') t.dim = between(0.6, 0.85)
  }
  return t
}

export interface PageEntry {
  file: string
  doc: string
  side: 'page' | 'front' | 'back'
  mrz: string[]
  truth: SideTruth
  trouble: Trouble
  /** The share of the height above the MRZ, which is all the VIZ reader reads. */
  above: number
}

const browser = await chromium.launch()
const page = await browser.newPage()
const entries: PageEntry[] = []
for (const doc of vizDocuments) {
  const sides = doc.format === 'TD3' ? (['page'] as const) : (['front', 'back'] as const)
  for (const side of sides) {
    const [wMm, hMm] = side === 'page' ? [125, 88] : [85.6, 54]
    for (let i = 0; i < variants; i++) {
      const t = trouble(i, side === 'page' ? 1600 : 1200)
      const W = t.width
      const H = Math.round((W * hMm) / wMm)
      const scale = W / (wMm * MM)
      await page.setViewportSize({ width: W, height: H })
      await page.setContent(`<style>${styles}
        body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #e9e6dc; }
        .place { position: absolute; left: 0; top: 0; transform-origin: 50% 50%; transform: rotate(${t.turn}deg) scale(${1 + Math.abs(t.turn) / 40}); filter: blur(${t.blur}px) brightness(${t.dim}); }
        .inner { transform: scale(${scale}); transform-origin: 0 0; width: ${wMm * MM}px; height: ${hMm * MM}px; }
        .light { position: absolute; inset: 0; background: linear-gradient(${between(0, 360)}deg, rgba(255,255,255,${t.light}), rgba(0,0,0,${t.light / 2})); mix-blend-mode: soft-light; }
        .glare { position: absolute; left: ${between(5, 60)}%; top: ${between(5, 50)}%; width: 26%; height: 30%; border-radius: 50%; background: radial-gradient(closest-side, rgba(255,255,255,.85), rgba(255,255,255,0)); }
        .noise { position: absolute; inset: 0; opacity: ${t.noise}; mix-blend-mode: multiply; }
      </style>
      <div class="place" style="width:${W}px;height:${H}px"><div class="inner">${vizSideHtml(doc, side)}</div></div>
      <div class="light"></div>${t.glare ? '<div class="glare"></div>' : ''}
      <svg class="noise" width="${W}" height="${H}"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="${Math.round(rnd() * 999)}"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`)
      await page.evaluate(() => document.fonts.ready)
      const file = `${doc.id}-${side}-${i}.jpg`
      writeFileSync(out + file, await page.screenshot({ type: 'jpeg', quality: Math.round(t.jpeg * 100) }))
      // The MRZ starts 15 mm from a passport page's foot and 16 mm from a card's.
      const above = side === 'page' ? (88 - 16) / 88 : side === 'back' ? (54 - 17) / 54 : 1
      entries.push({ file, doc: doc.id, side, mrz: mrzOf(doc), truth: truthOf(doc, side), trouble: t, above })
    }
  }
}
await browser.close()
writeFileSync(out + 'index.json', JSON.stringify({ made: new Date().toISOString(), entries }, null, 1))
console.log(`${entries.length} pages in ${out}`)
