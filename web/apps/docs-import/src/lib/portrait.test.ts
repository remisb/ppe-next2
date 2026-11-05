import type { BandPlace } from '@ppe/mrz/reader'

import { PORTRAIT_RATIO, cropRect, fitBox, moveBox, portraitBox, resizeBox } from './portrait'

/** A box's own ratio in pixels, for a picture of this aspect. */
const ratio = (b: { w: number; h: number }, aspect: number) => (b.w * aspect) / b.h

describe('portrait', () => {
  // The specimen passport page drawn at 10 px a mm: 1250 × 880, its portrait at 6–38 mm, 13–55 mm.
  const aspect = 1250 / 880
  const band: BandPlace = {
    centre: { x: 62.5 / 125, y: 77.2 / 88 },
    size: { width: 115.76 / 125, height: 11.6 / 88 },
    angle: 0,
    format: 'TD3',
    aspect,
  }

  it("starts a passport's portrait from its MRZ band, over the specimen's portrait", () => {
    const b = portraitBox('passport', aspect, band)
    const mm = (x: number, y: number) => ({ x: x / 125, y: y / 88 })
    const centre = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    expect(Math.abs(centre.x - mm(22, 34).x)).toBeLessThan(0.02)
    expect(Math.abs(centre.y - mm(22, 34).y)).toBeLessThan(0.04)
    expect(b.w * 125).toBeGreaterThan(32)
    expect(ratio(b, aspect)).toBeCloseTo(PORTRAIT_RATIO)
  })

  it('follows the page when it is smaller in the picture and turned', () => {
    // The page at half the size, in the picture's lower right, turned 5°.
    const small: BandPlace = { ...band, centre: { x: 0.75, y: 0.9 }, size: { width: band.size.width / 2, height: band.size.height / 2 }, angle: 5 }
    const b = portraitBox('passport', aspect, small)
    expect(b.w).toBeCloseTo(portraitBox('passport', aspect, band).w / 2, 2)
    expect(b.x).toBeGreaterThan(0.45)
    expect(b.y + b.h).toBeLessThan(0.9)
  })

  it("starts a card's front, or a picture without a band, as the document filling it", () => {
    const card = portraitBox('card', 85.6 / 54)
    expect(card.x).toBeCloseTo(3 / 85.6)
    expect(card.w).toBeCloseTo(27 / 85.6)
    expect(ratio(card, 85.6 / 54)).toBeCloseTo(PORTRAIT_RATIO)
  })

  it('moves and resizes inside the picture, 3:4 kept', () => {
    const b = portraitBox('card', 1.5)
    const moved = moveBox(b, 2, 2, 1.5)
    expect(moved.x + moved.w).toBeCloseTo(1)
    expect(moved.y + moved.h).toBeCloseTo(1)
    const big = resizeBox(b, 5, 1.5)
    expect(big.h).toBeLessThanOrEqual(1)
    expect(ratio(big, 1.5)).toBeCloseTo(PORTRAIT_RATIO)
    expect(resizeBox(b, 0, 1.5).w).toBeCloseTo(0.1)
    expect(fitBox({ x: -1, y: -1, w: 0.2, h: 0.3 }, 1.5)).toEqual({ x: 0, y: 0, w: 0.2, h: 0.3 })
  })

  it('crops in whole pixels', () => {
    expect(cropRect({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, 1000, 500)).toEqual({ x: 100, y: 100, w: 300, h: 200 })
  })
})
