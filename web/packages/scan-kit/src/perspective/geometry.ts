/**
 * Points, quadrilaterals and pictures as plain numbers (docs-import's Scan
 * Document: a page's 4 corners, flattened by a perspective transform). No DOM,
 * so the worker and tests use them as they are.
 */

export interface Point {
  x: number
  y: number
}

/** A page's corners: top left, top right, bottom right, bottom left. */
export type Quad = [Point, Point, Point, Point]

/** An RGBA picture, as ImageData holds it. */
export interface Rgba {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** A grey picture: one byte a pixel, 0 black. */
export interface Grey {
  width: number
  height: number
  data: Uint8Array
}

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/** The 4 points in order: top left first (the smallest x + y), then clockwise as seen on screen. */
export function orderCorners(points: readonly Point[]): Quad {
  if (points.length !== 4) throw new RangeError('four corners')
  const cx = points.reduce((s, p) => s + p.x, 0) / 4
  const cy = points.reduce((s, p) => s + p.y, 0) / 4
  // y grows downwards, so a growing angle goes clockwise on screen.
  const round = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let first = 0
  for (let i = 1; i < 4; i++) if (round[i]!.x + round[i]!.y < round[first]!.x + round[first]!.y) first = i
  return [0, 1, 2, 3].map((i) => round[(first + i) % 4]!) as Quad
}

/** The quad's area (the shoelace formula), whichever way round it goes. */
export function areaOf(q: Quad): number {
  let s = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]!
    const b = q[(i + 1) % 4]!
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

/** Every turn at a corner the same way, none of them straight. */
export function isConvex(q: Quad): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]!
    const b = q[(i + 1) % 4]!
    const c = q[(i + 2) % 4]!
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-9) return false
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** The inner angle at each corner, degrees. */
export function cornerAngles(q: Quad): number[] {
  return q.map((b, i) => {
    const a = q[(i + 3) % 4]!
    const c = q[(i + 1) % 4]!
    const v1 = { x: a.x - b.x, y: a.y - b.y }
    const v2 = { x: c.x - b.x, y: c.y - b.y }
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y))
    return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI
  })
}

/** The quad's width and height: the means of its opposite sides. */
export function sidesOf(q: Quad): { width: number; height: number } {
  return {
    width: (distance(q[0], q[1]) + distance(q[3], q[2])) / 2,
    height: (distance(q[1], q[2]) + distance(q[0], q[3])) / 2,
  }
}

/** The quad scaled by factor (both axes). */
export const scaleQuad = (q: Quad, factor: number): Quad => q.map((p) => ({ x: p.x * factor, y: p.y * factor })) as Quad

/** A rectangle's corners, from (0, 0). */
export const rectQuad = (width: number, height: number): Quad => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
]
