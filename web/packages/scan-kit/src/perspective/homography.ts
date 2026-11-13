/**
 * The perspective transform between two quadrilaterals: a 3 × 3 matrix, its
 * last entry 1, from the 4 point pairs (8 equations, Gaussian elimination
 * with partial pivoting).
 */
import type { Point, Quad } from './geometry.ts'

/** Row by row. */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

/** The matrix that takes from's corners to to's, corner by corner. */
export function homography(from: Quad, to: Quad): Mat3 {
  const a: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!
    const { x: X, y: Y } = to[i]!
    a.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X])
    a.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y])
  }
  const h = solve(a)
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1]
}

/** Solves the augmented system a (n rows, n + 1 columns). Throws when it has no single answer (corners in a line). */
function solve(a: number[][]): number[] {
  const n = a.length
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r
    if (Math.abs(a[pivot]![col]!) < 1e-12) throw new RangeError('degenerate corners')
    ;[a[col], a[pivot]] = [a[pivot]!, a[col]!]
    const row = a[col]!
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = a[r]![col]! / row[col]!
      if (f === 0) continue
      for (let c = col; c <= n; c++) a[r]![c]! -= f * row[c]!
    }
  }
  return a.map((row, i) => row[n]! / row[i]!)
}

export function mapPoint(m: Mat3, p: Point): Point {
  const w = m[6] * p.x + m[7] * p.y + m[8]
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w }
}

/** The inverse transform. */
export function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-15) throw new RangeError('singular')
  const k = 1 / det
  return [
    A * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    C * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ]
}
