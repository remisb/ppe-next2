/**
 * The test set phase 1 measures on: the specimen documents
 * (web/e2e/fixtures/documents/specimens.ts) as phone-like photos, 2000 ×
 * 1500, on a table, turned, tilted, blurred, lit unevenly, noisy, small in
 * the frame and JPEG-compressed, in a seeded mix; and live-sized frames,
 * 1280 × 720, the document filling a guide, with the strip where its MRZ is
 * expected. Writes .photos/*.jpg and .photos/index.json with each one's true
 * MRZ and the outcome a reader must give: read (the true MRZ), rejected
 * (a planted misread no reader may accept), or none (a card's front).
 *
 *   node --experimental-strip-types scripts/photos.ts [variants per side, 24] [live frames per document, 6]
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

import { mrzOf, sideHtml, sidesOf, specimenDocuments, styles } from '../../../e2e/fixtures/documents/specimens.ts'

const variants = Number(process.argv[2] ?? 24)
const liveFrames = Number(process.argv[3] ?? 6)
const out = fileURLToPath(new URL('../.photos/', import.meta.url))
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

let seed = 9303
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
const between = (a: number, b: number) => a + rnd() * (b - a)

/** CSS pixels a millimetre at scale 1. */
const MM = 96 / 25.4

interface Rough {
  /** The document's width as a share of the photo's. */
  fill: number
  turn: number
  tiltX: number
  tiltY: number
  blur: number
  light: number
  dim: number
  noise: number
  jpeg: number
  glare: boolean
}

/** The seeded mix: each photo gets a few of the troubles, some get none. */
function rough(i: number): Rough {
  const r: Rough = { fill: between(0.62, 0.9), turn: between(-2, 2), tiltX: 0, tiltY: 0, blur: 0, light: 0, dim: 1, noise: 0, jpeg: 0.9, glare: false }
  if (i === 0) return { ...r, turn: 0, fill: 0.85 }
  const troubles = ['turn', 'tilt', 'blur', 'light', 'small', 'noise', 'glare', 'dim'].filter(() => rnd() < 0.4)
  for (const t of troubles) {
    if (t === 'turn') r.turn = between(4, 10) * (rnd() < 0.5 ? -1 : 1)
    if (t === 'tilt') (r.tiltX = between(-14, 14)), (r.tiltY = between(-12, 12))
    if (t === 'blur') r.blur = between(0.6, 2.2)
    if (t === 'light') r.light = between(0.25, 0.6)
    if (t === 'small') r.fill = between(0.4, 0.55)
    if (t === 'noise') (r.noise = between(0.08, 0.22)), (r.jpeg = between(0.55, 0.75))
    if (t === 'glare') r.glare = true
    if (t === 'dim') r.dim = between(0.55, 0.8)
  }
  return r
}

/**
 * The document at the centre (cx, cy) of a W × H photo, r.fill of its width,
 * turned and tilted about its centre (a camera about 2.4 page widths away).
 */
function scene(html: string, widthMm: number, heightMm: number, W: number, H: number, r: Rough, cx: number, cy: number): string {
  const scale = (W * r.fill) / (widthMm * MM)
  return `<style>${styles}
      body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: radial-gradient(ellipse at 30% 20%, #8a7560, #4b3b2c); }
      .place { position: absolute; left: ${cx - (widthMm * MM) / 2}px; top: ${cy - (heightMm * MM) / 2}px; transform-origin: 50% 50%;
        transform: perspective(${W * r.fill * 2.4}px) rotateX(${r.tiltX}deg) rotateY(${r.tiltY}deg) rotate(${r.turn}deg) scale(${scale});
        filter: blur(${r.blur / scale}px) brightness(${r.dim}); box-shadow: 0 1mm 3mm rgba(0,0,0,.45); }
      .light { position: absolute; inset: 0; background: linear-gradient(${between(0, 360)}deg, rgba(255,255,255,${r.light}), rgba(0,0,0,${r.light / 2})); mix-blend-mode: soft-light; }
      .glare { position: absolute; left: ${between(10, 50)}%; top: ${between(5, 35)}%; width: 28%; height: 30%; border-radius: 50%;
        background: radial-gradient(closest-side, rgba(255,255,255,.85), rgba(255,255,255,0)); }
      .noise { position: absolute; inset: 0; opacity: ${r.noise}; mix-blend-mode: multiply; }
    </style>
    <div class="place">${html}</div>
    <div class="light"></div>${r.glare ? '<div class="glare"></div>' : ''}
    <svg class="noise" width="${W}" height="${H}"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="${Math.round(rnd() * 999)}"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`
}

interface Photo {
  file: string
  doc: string
  side: string
  truth: string[]
  outcome: 'read' | 'rejected' | 'none'
  rough: Rough
}
interface Live {
  file: string
  doc: string
  truth: string[]
  outcome: 'read' | 'rejected'
  /** The part of the frame read live: the guide's bottom strip, where the MRZ is expected. */
  strip: { x: number; y: number; w: number; h: number }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 2000, height: 1500 } })
const photos: Photo[] = []
const live: Live[] = []
for (const doc of specimenDocuments) {
  const outcome = doc.plant?.outcome === 'rejected' ? 'rejected' : 'read'
  for (const side of sidesOf(doc)) {
    const widthMm = side === 'page' ? 125 : 85.6
    const heightMm = side === 'page' ? 88 : 54
    const n = side === 'front' ? 2 : variants
    for (let i = 0; i < n; i++) {
      const r = rough(i)
      const W = 2000
      const H = 1500
      // The whole document in the photo: its turned bounding box (and a tenth for the tilt) within a margin.
      let bw = 0
      let bh = 0
      for (;;) {
        const a = (Math.abs(r.turn) * Math.PI) / 180
        const w = W * r.fill
        const h = (w * heightMm) / widthMm
        bw = (w * Math.cos(a) + h * Math.sin(a)) * (r.tiltY ? 1.1 : 1)
        bh = (w * Math.sin(a) + h * Math.cos(a)) * (r.tiltX ? 1.1 : 1)
        if (bw < W * 0.96 && bh < H * 0.96) break
        r.fill *= 0.95
      }
      await page.setViewportSize({ width: W, height: H })
      await page.setContent(scene(sideHtml(doc, side), widthMm, heightMm, W, H, r, bw / 2 + 20 + rnd() * (W - bw - 40), bh / 2 + 20 + rnd() * (H - bh - 40)))
      await page.evaluate(() => document.fonts.ready)
      const file = `${doc.id}-${side}-${i}.jpg`
      writeFileSync(out + file, await page.screenshot({ type: 'jpeg', quality: Math.round(r.jpeg * 100) }))
      photos.push({ file, doc: doc.id, side, truth: side === 'front' ? [] : mrzOf(doc), outcome: side === 'front' ? 'none' : outcome, rough: r })
    }
    if (side === 'front') continue
    // Live frames: the document filling the guide (90 % of a 1280 × 720 frame's height for a card's
    // back, its width at 70 %), held a little off, the strip its lower 40 %.
    for (let i = 0; i < liveFrames; i++) {
      const W = 1280
      const H = 720
      const gh = H * 0.86
      const gw = (gh * widthMm) / heightMm
      const gx = (W - gw) / 2
      const gy = (H - gh) / 2
      const r: Rough = { ...rough(1 + i), fill: (gw / W) * between(0.94, 1.0), turn: between(-3, 3), tiltX: 0, tiltY: 0 }
      await page.setViewportSize({ width: W, height: H })
      await page.setContent(scene(sideHtml(doc, side), widthMm, heightMm, W, H, r, W / 2 + between(-12, 12), H / 2 + between(-10, 10)))
      await page.evaluate(() => document.fonts.ready)
      const file = `live-${doc.id}-${i}.jpg`
      writeFileSync(out + file, await page.screenshot({ type: 'jpeg', quality: 80 }))
      live.push({ file, doc: doc.id, truth: mrzOf(doc), outcome, strip: { x: Math.round(gx), y: Math.round(gy + gh * 0.6), w: Math.round(gw), h: Math.round(gh * 0.4) } })
    }
  }
}
await browser.close()
writeFileSync(out + 'index.json', JSON.stringify({ made: new Date().toISOString(), photos, live }, null, 1))
console.log(`${photos.length} photos, ${live.length} live frames in ${out}`)
