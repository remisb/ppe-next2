import { describe, expect, it } from 'vitest'

import { areaOf, distance, isConvex, orderCorners, rectQuad, type Point, type Quad, type Rgba } from './geometry.ts'
import { homography, invert, mapPoint } from './homography.ts'
import { CONFIDENT, findPage } from './page.ts'
import { pageSize, warpPage } from './warp.ts'

/** A repeatable random number in [0, 1). */
function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/**
 * A page like a passport's data page, at (u, v) in [0, 1]²: light paper, a
 * dark portrait box, rows of "text" and two MRZ-like rows at the bottom.
 */
function pageAt(u: number, v: number): number {
  if (u > 0.04 && u < 0.32 && v > 0.14 && v < 0.62) return 70
  if (v > 0.8 && v < 0.84 && u > 0.04 && u < 0.96 && Math.floor(u * 90) % 2 === 0) return 30
  if (v > 0.88 && v < 0.92 && u > 0.04 && u < 0.96 && Math.floor(u * 90) % 2 === 0) return 30
  for (const row of [0.18, 0.28, 0.38, 0.48, 0.58]) if (v > row && v < row + 0.03 && u > 0.38 && u < 0.8 && Math.floor(u * 60) % 3 !== 0) return 60
  return 225
}

/** A width × height photo of the page with corners, on a noisy darker background. */
function photo(width: number, height: number, corners: Quad, seed = 1): Rgba {
  const toPage = homography(corners, rectQuad(1, 1))
  const rnd = random(seed)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = mapPoint(toPage, { x: x + 0.5, y: y + 0.5 })
      const inside = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
      const v = inside ? pageAt(p.x, p.y) + (rnd() - 0.5) * 12 : 95 + (rnd() - 0.5) * 40
      const o = (y * width + x) * 4
      data[o] = data[o + 1] = data[o + 2] = v
      data[o + 3] = 255
    }
  }
  return { width, height, data }
}

/** The largest distance between matching corners, as a share of the page's longer side. */
function cornerError(found: Quad, truth: Quad): number {
  const size = Math.max(distance(truth[0], truth[1]), distance(truth[1], truth[2]))
  return Math.max(...found.map((p, i) => distance(p, truth[i]!))) / size
}

const nudge = (q: Quad, d: number): Quad => q.map((p, i) => ({ x: p.x + (i % 2 ? d : -d), y: p.y + (i < 2 ? d : -d) })) as Quad

describe('geometry', () => {
  it('orders corners from the top left, clockwise on screen', () => {
    const q = orderCorners([
      { x: 90, y: 80 },
      { x: 10, y: 5 },
      { x: 5, y: 70 },
      { x: 100, y: 10 },
    ])
    expect(q).toEqual([
      { x: 10, y: 5 },
      { x: 100, y: 10 },
      { x: 90, y: 80 },
      { x: 5, y: 70 },
    ])
  })

  it('knows a convex quad from a bent one, and its area', () => {
    expect(isConvex(rectQuad(4, 3))).toBe(true)
    expect(areaOf(rectQuad(4, 3))).toBe(12)
    const bent: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 10 },
    ]
    expect(isConvex(bent)).toBe(false)
  })
})

describe('homography', () => {
  const slanted: Quad = [
    { x: 120, y: 90 },
    { x: 610, y: 60 },
    { x: 660, y: 470 },
    { x: 90, y: 430 },
  ]

  it('takes each corner to its match, and back with the inverse', () => {
    const m = homography(rectQuad(500, 352), slanted)
    rectQuad(500, 352).forEach((p, i) => {
      const q = mapPoint(m, p)
      expect(q.x).toBeCloseTo(slanted[i]!.x, 6)
      expect(q.y).toBeCloseTo(slanted[i]!.y, 6)
    })
    const back = invert(m)
    const p: Point = { x: 321, y: 123 }
    const r = mapPoint(back, mapPoint(m, p))
    expect(r.x).toBeCloseTo(p.x, 6)
    expect(r.y).toBeCloseTo(p.y, 6)
  })

  it('refuses corners in a line', () => {
    const line: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]
    expect(() => homography(rectQuad(1, 1), line)).toThrow()
  })
})

describe('warp', () => {
  it('flattens a slanted page back to the page', () => {
    const corners: Quad = [
      { x: 110, y: 80 },
      { x: 560, y: 110 },
      { x: 600, y: 420 },
      { x: 70, y: 380 },
    ]
    const img = photo(680, 500, corners)
    const out = warpPage(img, corners, { width: 250, height: 176 })
    let wrong = 0
    for (let y = 2; y < out.height - 2; y++)
      for (let x = 2; x < out.width - 2; x++) {
        const want = pageAt((x + 0.5) / out.width, (y + 0.5) / out.height)
        if (Math.abs(out.data[(y * out.width + x) * 4]! - want) > 45) wrong++
      }
    // Only pixels on the printed boxes' borders may differ.
    expect(wrong / (out.width * out.height)).toBeLessThan(0.04)
  })

  it('sizes the page from the document shape, its long side along the longer one, within maxSide', () => {
    const q: Quad = [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 3000, y: 2000 },
      { x: 0, y: 2000 },
    ]
    expect(pageSize(q, { aspect: 125 / 88, maxSide: 2400 })).toEqual({ width: 2400, height: 1690 })
    const standing: Quad = [
      { x: 0, y: 0 },
      { x: 880, y: 0 },
      { x: 880, y: 1250 },
      { x: 0, y: 1250 },
    ]
    expect(pageSize(standing, { aspect: 125 / 88 })).toEqual({ width: 880, height: 1250 })
  })
})

describe('findPage', () => {
  const cases: { name: string; corners: Quad }[] = [
    {
      name: 'square on',
      corners: [
        { x: 100, y: 90 },
        { x: 700, y: 90 },
        { x: 700, y: 512 },
        { x: 100, y: 512 },
      ],
    },
    {
      name: 'turned a little',
      corners: [
        { x: 130, y: 120 },
        { x: 690, y: 70 },
        { x: 726, y: 470 },
        { x: 166, y: 520 },
      ],
    },
    {
      name: 'slanted (shot from below and the side)',
      corners: [
        { x: 190, y: 110 },
        { x: 640, y: 80 },
        { x: 740, y: 520 },
        { x: 80, y: 540 },
      ],
    },
  ]

  for (const c of cases) {
    it(`finds the corners of a page ${c.name}, without a prior`, () => {
      const found = findPage(photo(820, 620, c.corners))
      expect(found.confidence).toBeGreaterThanOrEqual(CONFIDENT)
      expect(cornerError(found.corners, c.corners)).toBeLessThan(0.015)
    })

    it(`finds the corners of a page ${c.name}, from a prior 5 % off`, () => {
      const prior = nudge(c.corners, 30)
      const found = findPage(photo(820, 620, c.corners, 7), { prior, aspect: 125 / 88 })
      expect(found.confidence).toBeGreaterThanOrEqual(CONFIDENT)
      expect(cornerError(found.corners, c.corners)).toBeLessThan(0.015)
    })
  }

  it('works on a photo larger than its working side, giving corners in the photo’s pixels', () => {
    const corners: Quad = [
      { x: 260, y: 230 },
      { x: 1700, y: 160 },
      { x: 1820, y: 1250 },
      { x: 200, y: 1300 },
    ]
    const found = findPage(photo(2000, 1500, corners))
    expect(cornerError(found.corners, corners)).toBeLessThan(0.015)
  })

  it('takes the whole photo as the page when the page fills it (a scan): sure when the MRZ band puts the page there', () => {
    const whole = rectQuad(820, 578)
    const fromPrior = findPage(photo(820, 578, whole, 5), { prior: nudge(whole, 12), aspect: 125 / 88 })
    expect(fromPrior.confidence).toBeGreaterThanOrEqual(CONFIDENT)
    expect(cornerError(fromPrior.corners, whole)).toBeLessThan(0.015)
    // Without a band, the whole photo still, but to be looked at.
    const found = findPage(photo(820, 578, whole))
    expect(cornerError(found.corners, whole)).toBeLessThan(0.015)
  })

  it('keeps a page on a table over the whole photo, and finds one running off a side', () => {
    const offRight: Quad = [
      { x: 140, y: 90 },
      { x: 820, y: 70 },
      { x: 820, y: 520 },
      { x: 120, y: 540 },
    ]
    const found = findPage(photo(820, 620, offRight))
    expect(cornerError(found.corners, offRight)).toBeLessThan(0.015)
  })

  it('gives the photo’s own corners when there is no page to see', () => {
    const rnd = random(3)
    const data = new Uint8ClampedArray(400 * 300 * 4).map((_, i) => (i % 4 === 3 ? 255 : 100 + rnd() * 40))
    const found = findPage({ width: 400, height: 300, data })
    expect(cornerError(found.corners, rectQuad(400, 300))).toBeLessThan(0.015)
  })
})
