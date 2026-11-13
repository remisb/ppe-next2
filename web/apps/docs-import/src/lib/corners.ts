/**
 * Adjust Corners' rules (Scan Document): a corner moves within the photo,
 * and never so the page folds over itself; arrow keys move it a little. The
 * editor only wires pointers and keys to these. Pure, tested.
 */
import { isConvex, type Point, type Quad } from '@ppe/scan-kit/perspective'

/** The photo's own corners: the whole photo is the page. */
export function wholePhoto(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]
}

/** The quad with corner i moved to `to`, kept inside the photo; the quad as it was when the move would bend it. */
export function moveCorner(q: Quad, i: number, to: Point, width: number, height: number): Quad {
  const p = { x: Math.min(width, Math.max(0, to.x)), y: Math.min(height, Math.max(0, to.y)) }
  const next = q.map((c, j) => (j === i ? p : c)) as Quad
  return isConvex(next) ? next : q
}

/** A keyboard step: a hundredth of the photo's longer side, five times that with Shift. */
export function keyStep(width: number, height: number, large: boolean): number {
  return (Math.max(width, height) / 100) * (large ? 5 : 1)
}

/** The arrow keys' moves. */
export const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}
