import type { BandPlace } from '@ppe/mrz/reader'

import { aspectOf, pageQuad } from './page-box'

const near = (a: { x: number; y: number }, b: { x: number; y: number }, within: number) =>
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(within)

describe('pageQuad', () => {
  it("puts a passport page's corners where the specimen page is, square on", () => {
    // The specimen drawn at 10 px a mm and set in a 2000 × 1500 photo at (300, 200).
    const W = 2000
    const H = 1500
    const band: BandPlace = {
      centre: { x: (300 + 625) / W, y: (200 + 780) / H },
      size: { width: 1157.6 / W, height: 116 / H },
      angle: 0,
      format: 'TD3',
      aspect: W / H,
    }
    const q = pageQuad(band, W, H)
    near(q[0], { x: 300, y: 200 }, 1)
    near(q[1], { x: 1550, y: 200 }, 1)
    near(q[2], { x: 1550, y: 1080 }, 1)
    near(q[3], { x: 300, y: 1080 }, 1)
  })

  it('turns the page with the band', () => {
    const W = 1000
    const H = 1000
    const band: BandPlace = { centre: { x: 0.5, y: 0.5 }, size: { width: 0.4, height: 0.05 }, angle: 90, format: 'TD3', aspect: 1 }
    const q = pageQuad(band, W, H)
    // Turned a quarter clockwise, the page's top left is to the band's upper right.
    const mm = 400 / 115.76
    near(q[0], { x: 500 + 78 * mm, y: 500 - 62.5 * mm }, 0.5)
    near(q[2], { x: 500 - 10 * mm, y: 500 + 62.5 * mm }, 0.5)
  })

  it("places a card's back from its TD1 band, a small turn kept", () => {
    const band: BandPlace = { centre: { x: 0.5, y: 0.7 }, size: { width: 0.6, height: 0.1 }, angle: 4, format: 'TD1', aspect: 1.5 }
    const q = pageQuad(band, 1500, 1000)
    const top = Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x) * (180 / Math.PI)
    expect(top).toBeCloseTo(4, 5)
    const width = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y)
    const height = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y)
    expect(width / height).toBeCloseTo(85.6 / 54, 5)
  })
})

describe('aspectOf', () => {
  it("is the format's when read, else the type's", () => {
    expect(aspectOf('TD3', 'card')).toBeCloseTo(125 / 88)
    expect(aspectOf('TD1', 'passport')).toBeCloseTo(85.6 / 54)
    expect(aspectOf(undefined, 'card')).toBeCloseTo(85.6 / 54)
  })
})
