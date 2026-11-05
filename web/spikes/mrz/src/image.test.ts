/** The image operations on drawn pictures whose skew and MRZ place are known (plan §8, "Image ops"). */
import { findMrz, greyOf, mrzBand, rgbaOf, sampleRect, sauvola, scaled, skewAngle, textBands, type Grey } from './image.ts'

const W = 1400
const H = 1000

/** A page: rows of "characters" (two strokes each, at OCR-B's pitch of about 1.06 heights), VIZ rows above, and an MRZ of `lines` rows of `chars` at its foot. */
function page(lines: number, chars: number, opts: { faint?: boolean } = {}): Grey {
  const data = new Uint8Array(W * H).fill(235)
  const char = (x: number, y: number, v = 30) => {
    for (let yy = y; yy < y + 20; yy++) for (let xx = x; xx < x + 16; xx++) if (xx - x < 3 || xx - x > 12 || yy - y < 3) data[yy * W + xx] = v
  }
  // A faint guilloche: thin light curves a local threshold must drop.
  if (opts.faint) for (let x = 0; x < W; x++) for (let k = 0; k < 6; k++) data[Math.round(H / 2 + 300 * Math.sin(x / 40 + k)) * W + x] = 200
  for (let r = 0; r < 4; r++) for (let c = 0; c < 14; c++) char(600 + c * 21, 150 + r * 60)
  const left = (W - chars * 21) / 2
  for (let r = 0; r < lines; r++) for (let c = 0; c < chars; c++) char(left + c * 21, 780 - (lines - 1) * 34 + r * 34)
  return { width: W, height: H, data }
}

/** g turned by deg about its centre: the text then slopes by -deg. */
const turned = (g: Grey, deg: number) => sampleRect(g, W / 2, H / 2, deg, W, H, 1)

test('Sauvola keeps dark strokes and drops faint lines', () => {
  const ink = sauvola(page(2, 44, { faint: true }), 31)
  // A stroke's pixel is ink; a faint curve's is not.
  expect(ink[(780 + 10) * W + Math.round((W - 44 * 21) / 2) + 1]).toBe(1)
  let faint = 0
  for (let x = 0; x < W; x++) faint += ink[Math.round(H / 2 + 300 * Math.sin(x / 40)) * W + x]!
  expect(faint).toBeLessThan(W * 0.05)
})

test.each([0, 3.5, -6, 9])('the skew of text turned by %f°', (deg) => {
  const g = turned(page(2, 44), deg)
  expect(Math.abs(skewAngle(sauvola(g, 31), W, H) - -deg)).toBeLessThanOrEqual(0.3)
})

test('the MRZ is the bottom group of rows: two of 44 characters (TD3), three of 30 (TD1)', () => {
  for (const [lines, chars, format] of [[2, 44, 'TD3'], [3, 30, 'TD1'], [2, 36, 'TD2']] as const) {
    const ink = sauvola(page(lines, chars), 31)
    const band = mrzBand(textBands(ink, W, H))
    expect(band?.format).toBe(format)
    expect(band?.rows).toHaveLength(lines)
    expect(band!.rows.at(-1)!.bottom).toBeGreaterThan(790)
  }
})

test('no MRZ on a page of short rows', () => {
  const g = page(0, 0)
  expect(mrzBand(textBands(sauvola(g, 31), W, H))).toBeUndefined()
})

test('findMrz cuts the band out straightened, at the OCR height, from a turned page', () => {
  const g = turned(page(2, 44, { faint: true }), -5)
  const found = findMrz(rgbaOf(g))!
  expect(found.format).toBe('TD3')
  expect(Math.abs(found.angle - 5)).toBeLessThanOrEqual(0.3)
  // Its centre is where the MRZ's is once turned: the page centre's offset (0, 780 - 17 + 10 - 500) turned by 5°.
  const a = (5 * Math.PI) / 180
  const dy = 780 - 17 + 10 - H / 2
  expect(Math.abs(found.centre.x - (W / 2 - dy * Math.sin(a)))).toBeLessThan(20)
  expect(Math.abs(found.centre.y - (H / 2 + dy * Math.cos(a)))).toBeLessThan(20)
  // Black ink on white, two rows of characters ~32 px tall.
  const rows = textBands(Uint8Array.from(found.image.data, (v) => (v === 0 ? 1 : 0)), found.image.width, found.image.height)
  expect(rows).toHaveLength(2)
  for (const r of rows) expect(Math.abs(r.bottom - r.top - 32)).toBeLessThanOrEqual(4)
})

test('greyOf and scaled', () => {
  const g = greyOf({ width: 2, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]) })
  expect([...g.data]).toEqual([255, 0])
  expect([...scaled({ width: 2, height: 2, data: new Uint8Array([0, 100, 200, 100]) }, 0.5).data]).toEqual([100])
})
