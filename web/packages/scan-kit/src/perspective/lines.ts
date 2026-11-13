/**
 * Straight lines through the edge pixels, by Hough's vote: a line is
 * x·cos θ + y·sin θ = ρ, and each edge pixel votes only for the lines near
 * its own gradient's direction, so text and noise add little. A window keeps
 * the vote to one side of a page where it is expected to be.
 */
import type { Edges } from './edges.ts'
import type { Point } from './geometry.ts'

export interface Line {
  /** The normal's angle, radians. */
  theta: number
  rho: number
  votes: number
}

/** Where to look for one line: near this one, within dTheta and dRho, along the segment it should cover. */
export interface Window {
  theta: number
  rho: number
  dTheta: number
  dRho: number
  /** The side as expected: pixels whose foot on it is far off its ends do not vote. */
  segment: [Point, Point]
}

const DEG = Math.PI / 180

/** How far a pixel's gradient may be off a line's normal and still vote for it. */
const SPREAD = 3 * DEG

/** The smallest angle between two directions taken modulo π. */
export function angleBetween(a: number, b: number): number {
  let d = Math.abs(a - b) % Math.PI
  if (d > Math.PI / 2) d = Math.PI - d
  return d
}

/** The same line written with its normal within 90° of theta (θ + π is the same line with −ρ). */
export function alignTo(l: Line, theta: number): Line {
  let t = l.theta
  let r = l.rho
  while (t - theta > Math.PI / 2) {
    t -= Math.PI
    r = -r
  }
  while (theta - t > Math.PI / 2) {
    t += Math.PI
    r = -r
  }
  return { theta: t, rho: r, votes: l.votes }
}

/** The line through two points. */
export function lineThrough(a: Point, b: Point): Line {
  const theta = Math.atan2(b.x - a.x, -(b.y - a.y))
  return { theta, rho: a.x * Math.cos(theta) + a.y * Math.sin(theta), votes: 0 }
}

/** Where two lines cross, or undefined when they are near parallel. */
export function crossing(a: Line, b: Line): Point | undefined {
  const ca = Math.cos(a.theta)
  const sa = Math.sin(a.theta)
  const cb = Math.cos(b.theta)
  const sb = Math.sin(b.theta)
  const det = ca * sb - sa * cb
  if (Math.abs(det) < Math.sin(20 * DEG)) return undefined
  return { x: (a.rho * sb - b.rho * sa) / det, y: (ca * b.rho - cb * a.rho) / det }
}

export interface HoughOptions {
  /** The most lines to return, strongest first. */
  max: number
  window?: Window
}

/** The strongest lines, none two alike. */
export function houghLines(e: Edges, o: HoughOptions): Line[] {
  const { width: w, height: h } = e
  const diag = Math.ceil(Math.hypot(w, h))
  const step = 0.5 * DEG
  const win = o.window
  // The angles voted for: all of [0, π), or the window's range.
  const thetas: number[] = []
  if (win) for (let t = win.theta - win.dTheta; t <= win.theta + win.dTheta + 1e-9; t += step) thetas.push(t)
  else for (let t = 0; t < Math.PI - 1e-9; t += step) thetas.push(t)
  const cos = thetas.map(Math.cos)
  const sin = thetas.map(Math.sin)
  const nRho = 2 * diag + 1
  const acc = new Float32Array(thetas.length * nRho)

  let seg: { ax: number; ay: number; dx: number; dy: number; len2: number } | undefined
  if (win) {
    const [a, b] = win.segment
    seg = { ax: a.x, ay: a.y, dx: b.x - a.x, dy: b.y - a.y, len2: (b.x - a.x) ** 2 + (b.y - a.y) ** 2 }
  }
  const wc = win ? Math.cos(win.theta) : 0
  const ws = win ? Math.sin(win.theta) : 0
  const spreadSteps = Math.ceil(SPREAD / step)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!e.on[i]) continue
      const phi = e.dir[i]!
      const weight = Math.min(1, e.mag[i]! / 255)
      if (win && seg) {
        if (Math.abs(x * wc + y * ws - win.rho) > win.dRho) continue
        if (angleBetween(phi, win.theta) > win.dTheta + SPREAD) continue
        const t = ((x - seg.ax) * seg.dx + (y - seg.ay) * seg.dy) / seg.len2
        if (t < -0.1 || t > 1.1) continue
        for (let k = 0; k < thetas.length; k++) {
          if (angleBetween(phi, thetas[k]!) > SPREAD) continue
          const r = Math.round(x * cos[k]! + y * sin[k]!) + diag
          acc[k * nRho + r]! += weight
        }
      } else {
        // The gradient's own angle and a few either side, wrapping at π.
        const centre = Math.round(phi / step)
        for (let d = -spreadSteps; d <= spreadSteps; d++) {
          let k = centre + d
          if (k < 0) k += thetas.length
          if (k >= thetas.length) k -= thetas.length
          const r = Math.round(x * cos[k]! + y * sin[k]!) + diag
          acc[k * nRho + r]! += weight
        }
      }
    }
  }

  // Peaks: cells largest in their neighbourhood, then the strongest first, none near another.
  const peaks: Line[] = []
  const nT = thetas.length
  let best = 0
  for (const v of acc) if (v > best) best = v
  const floor = Math.max(1, best * 0.1)
  for (let k = 0; k < nT; k++) {
    for (let r = 1; r < nRho - 1; r++) {
      const v = acc[k * nRho + r]!
      if (v < floor) continue
      let top = true
      for (let dk = -2; dk <= 2 && top; dk++) {
        let kk = k + dk
        if (kk < 0 || kk >= nT) {
          if (win) continue
          kk = (kk + nT) % nT
        }
        for (let dr = -3; dr <= 3; dr++) {
          if (dk === 0 && dr === 0) continue
          const rr = r + dr
          if (rr < 0 || rr >= nRho) continue
          const u = acc[kk * nRho + rr]!
          if (u > v || (u === v && (dk < 0 || (dk === 0 && dr < 0)))) {
            top = false
            break
          }
        }
      }
      if (top) peaks.push({ theta: thetas[k]!, rho: r - diag, votes: v })
    }
  }
  peaks.sort((a, b) => b.votes - a.votes)
  const out: Line[] = []
  const nearRho = Math.max(4, diag * 0.01)
  for (const p of peaks) {
    if (out.length >= o.max) break
    if (out.some((q) => alike(p, q, nearRho))) continue
    out.push(p)
  }
  return out
}

function alike(a: Line, b: Line, nearRho: number): boolean {
  const c = alignTo(b, a.theta)
  return Math.abs(c.theta - a.theta) < 2 * DEG && Math.abs(c.rho - a.rho) < nearRho
}
