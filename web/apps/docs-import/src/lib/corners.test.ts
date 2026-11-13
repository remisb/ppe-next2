import { keyStep, moveCorner, wholePhoto } from './corners'

describe('corners', () => {
  const q = wholePhoto(400, 300)

  it('moves a corner, kept inside the photo', () => {
    expect(moveCorner(q, 0, { x: 30, y: 20 }, 400, 300)[0]).toEqual({ x: 30, y: 20 })
    expect(moveCorner(q, 2, { x: 380, y: 999 }, 400, 300)[2]).toEqual({ x: 380, y: 300 })
    expect(moveCorner(q, 0, { x: -50, y: 40 }, 400, 300)[0]).toEqual({ x: 0, y: 40 })
  })

  it('refuses a move that folds the page over itself', () => {
    // The top left dragged past the bottom right.
    expect(moveCorner(q, 0, { x: 390, y: 290 }, 400, 300)).toBe(q)
  })

  it('steps by a hundredth of the longer side, five times with Shift', () => {
    expect(keyStep(400, 300, false)).toBe(4)
    expect(keyStep(400, 300, true)).toBe(20)
  })
})
