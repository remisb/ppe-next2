/**
 * Finding a document page's 4 corners in a photo (docs-import's Scan
 * Document), for the perspective transform that flattens it: edges, the
 * strongest straight lines, every quadrilateral two pairs of them make, and
 * the one whose 4 sides are best covered by edges, weighted by its size, so a
 * page wins over the boxes printed on it. With a prior (where the page is
 * expected, from its MRZ band), each side is looked for only near its expected
 * place. Pure, no DOM: it runs in perspective.worker.ts.
 */
import { edgesOf, greyOf, shrink, type Edges } from './edges.ts'
import {
  areaOf,
  cornerAngles,
  distance,
  isConvex,
  orderCorners,
  rectQuad,
  scaleQuad,
  sidesOf,
  type Point,
  type Quad,
  type Rgba,
} from './geometry.ts'
import { alignTo, angleBetween, crossing, houghLines, lineThrough, type Line } from './lines.ts'

export interface FindPageOptions {
  /** Where the page is expected, in the picture's pixels: each side is looked for near its own. */
  prior?: Quad
  /** The document's width over its height, when known: a quad far from it is no page. */
  aspect?: number
}

export interface PageFound {
  /** In the picture's pixels: top left, top right, bottom right, bottom left. */
  corners: Quad
  /** 0–1: how well edges cover the 4 sides. Below CONFIDENT the corners want a look (Check corners). */
  confidence: number
}

/** The confidence from which corners are taken without a look. */
export const CONFIDENT = 0.5

/** The side the search works at, in pixels: enough for a page's border, quick in a worker. */
const WORK_SIDE = 1000

const DEG = Math.PI / 180

/** How far a side may be from where the prior puts it: a share of the page's longer side. */
const PRIOR_STRIP = 0.12

/** How far a side's angle may be from the prior's. */
const PRIOR_TURN = 10 * DEG

/** Lines tried per side with a prior, and per direction without. */
const PER_SIDE = 4
const PER_FAMILY = 8

/** A page fills at least this share of the picture. */
const MIN_AREA = 0.2

/** A corner's angle stays within these, degrees. */
const MIN_ANGLE = 60
const MAX_ANGLE = 120

/** A page's long-to-short ratio is within this share of the document's. */
const ASPECT_SLACK = 0.25

/**
 * A side along the photo's own border has no edge to see: the page runs out of
 * the picture there. A quad may have one or two such sides, scored this and
 * each costing BORDER_COST, and only when its other sides are seen clearly
 * (STRONG_SIDE). The whole photo is never a candidate: it is what is left
 * when nothing is sure (see findPage).
 */
const BORDER_SCORE = 0.35
const BORDER_COST = 0.9
const STRONG_SIDE = 0.7

/** How near a prior's corners must be to the photo's, as a share of its sides, for the photo to be the page (a scan). */
const WHOLE_NEAR = 0.08

/** How near the border, as a share of the picture's side, a side counts as along it. */
const BORDER_NEAR = 0.015

export function findPage(img: Rgba, o: FindPageOptions = {}): PageFound {
  const { grey, factor } = shrink(greyOf(img), WORK_SIDE)
  const edges = edgesOf(grey)
  const prior = o.prior ? scaleQuad(o.prior, factor) : undefined
  let best = prior ? bestQuad(edges, sideCandidates(edges, prior), o.aspect) : undefined
  if (!best || best.confidence < CONFIDENT) {
    const free = bestQuad(edges, familyCandidates(edges, Math.min(edges.width, edges.height)), o.aspect)
    if (free && (!best || free.score > best.score)) best = free
  }
  if (best && best.confidence >= CONFIDENT) return { corners: scaleQuad(best.corners, 1 / factor), confidence: best.confidence }
  // Nothing sure. The page fills the photo when the MRZ band puts it there (a scan, or a photo cropped to it): sure.
  // Else where the band puts it, or the whole photo without a band; both to be looked at.
  const whole = rectQuad(img.width, img.height)
  const unsure = best?.confidence ?? 0
  if (o.prior) return nearWhole(o.prior, img.width, img.height) ? { corners: whole, confidence: 1 } : { corners: o.prior, confidence: unsure }
  return { corners: whole, confidence: unsure }
}

/** Every corner of q within WHOLE_NEAR of the photo's own. */
function nearWhole(q: Quad, w: number, h: number): boolean {
  return rectQuad(w, h).every((c, i) => Math.abs(q[i]!.x - c.x) <= WHOLE_NEAR * w && Math.abs(q[i]!.y - c.y) <= WHOLE_NEAR * h)
}

/** Every quad from one candidate line per side (top, right, bottom, left), with a prior. */
function sideCandidates(edges: Edges, prior: Quad): Quad[] {
  const { width, height } = sidesOf(prior)
  const strip = PRIOR_STRIP * Math.max(width, height)
  const sides = [0, 1, 2, 3].map((i) => {
    const a = prior[i]!
    const b = prior[(i + 1) % 4]!
    const expected = lineThrough(a, b)
    const found = houghLines(edges, {
      max: PER_SIDE,
      window: { theta: expected.theta, rho: expected.rho, dTheta: PRIOR_TURN, dRho: strip, segment: [a, b] },
    })
    // The photo's border, when it runs where this side is expected: the page may run out of the picture.
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const border = bordersOf(edges.width, edges.height).find(
      (l) => angleBetween(l.theta, expected.theta) <= 2 * PRIOR_TURN && Math.abs(mid.x * Math.cos(l.theta) + mid.y * Math.sin(l.theta) - l.rho) <= 2 * strip,
    )
    const lines = border ? [...found, border] : found
    return lines.length ? lines : [expected]
  })
  const quads: Quad[] = []
  for (const top of sides[0]!)
    for (const right of sides[1]!)
      for (const bottom of sides[2]!)
        for (const left of sides[3]!) {
          const q = quadOf(top, right, bottom, left)
          if (q) quads.push(q)
        }
  return quads
}

/**
 * Every quad from two lines of one direction and two of the other, without a
 * prior: the strongest line sets the directions; lines within 30° of it or of
 * its normal are the two families.
 */
function familyCandidates(edges: Edges, shortSide: number): Quad[] {
  const seen = houghLines(edges, { max: 30 })
  if (seen.length === 0) return []
  const borders = bordersOf(edges.width, edges.height)
  const t0 = seen[0]!.theta
  const near = (l: Line, t: number) => angleBetween(l.theta, t) <= 30 * DEG
  // The strongest lines of each direction, and the photo's borders of that direction (a page may run out of it).
  const family = (t: number) => [...seen.filter((l) => near(l, t)).slice(0, PER_FAMILY), ...borders.filter((l) => near(l, t))].map((l) => alignTo(l, t))
  const a = family(t0)
  const t1 = t0 + Math.PI / 2
  const b = family(t1)
  const apart = 0.1 * shortSide
  const quads: Quad[] = []
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++) {
      if (Math.abs(a[i]!.rho - a[j]!.rho) < apart) continue
      for (let k = 0; k < b.length; k++)
        for (let l = k + 1; l < b.length; l++) {
          if (Math.abs(b[k]!.rho - b[l]!.rho) < apart) continue
          const q = quadOf(a[i]!, b[k]!, a[j]!, b[l]!)
          if (q) quads.push(q)
        }
    }
  return quads
}

/** The quad 4 lines make, going round (each crossing the next), or undefined when two do not cross. */
function quadOf(l0: Line, l1: Line, l2: Line, l3: Line): Quad | undefined {
  const ls = [l0, l1, l2, l3]
  const points: Point[] = []
  for (let i = 0; i < 4; i++) {
    const p = crossing(ls[i]!, ls[(i + 1) % 4]!)
    if (!p) return undefined
    points.push(p)
  }
  return orderCorners(points)
}

/** The photo's 4 borders as lines: top, right, bottom, left. */
function bordersOf(w: number, h: number): Line[] {
  return [
    { theta: Math.PI / 2, rho: 0, votes: 0 },
    { theta: 0, rho: w, votes: 0 },
    { theta: Math.PI / 2, rho: h, votes: 0 },
    { theta: 0, rho: 0, votes: 0 },
  ]
}

/** Whether a side runs along one of the photo's borders. */
function alongBorder(a: Point, b: Point, w: number, h: number): boolean {
  const nx = BORDER_NEAR * w
  const ny = BORDER_NEAR * h
  return (
    (Math.abs(a.y) <= ny && Math.abs(b.y) <= ny) ||
    (Math.abs(a.y - h) <= ny && Math.abs(b.y - h) <= ny) ||
    (Math.abs(a.x) <= nx && Math.abs(b.x) <= nx) ||
    (Math.abs(a.x - w) <= nx && Math.abs(b.x - w) <= nx)
  )
}

interface Scored {
  corners: Quad
  confidence: number
  score: number
}

function bestQuad(edges: Edges, quads: Quad[], aspect?: number): Scored | undefined {
  const { width: w, height: h } = edges
  const area = w * h
  let best: Scored | undefined
  for (const q of quads) {
    if (!isConvex(q)) continue
    if (q.some((p) => p.x < -0.05 * w || p.y < -0.05 * h || p.x > 1.05 * w || p.y > 1.05 * h)) continue
    if (cornerAngles(q).some((a) => a < MIN_ANGLE || a > MAX_ANGLE)) continue
    const share = areaOf(q) / area
    if (share < MIN_AREA) continue
    if (aspect && !aspectFits(q, aspect)) continue
    // A side along the photo's border scores BORDER_SCORE and counts as sure; the others must then be clear.
    const sides = [0, 1, 2, 3].map((i) => {
      const a = q[i]!
      const b = q[(i + 1) % 4]!
      if (alongBorder(a, b, w, h)) return { border: true, score: BORDER_SCORE, sure: 1 }
      const v = sideSupport(edges, a, b)
      return { border: false, score: v, sure: v }
    })
    const borders = sides.filter((x) => x.border).length
    if (borders > 2) continue
    if (borders > 0 && sides.some((x) => !x.border && x.sure < STRONG_SIDE)) continue
    const blend = (vs: number[]) => 0.5 * (vs.reduce((s, v) => s + v, 0) / 4) + 0.5 * Math.min(...vs)
    const confidence = blend(sides.map((x) => x.sure))
    const score = blend(sides.map((x) => x.score)) * Math.sqrt(share) * BORDER_COST ** borders
    if (!best || score > best.score) best = { corners: q, confidence, score }
  }
  return best
}

function aspectFits(q: Quad, aspect: number): boolean {
  const { width, height } = sidesOf(q)
  const ratio = Math.max(width, height) / Math.min(width, height)
  const doc = Math.max(aspect, 1 / aspect)
  return Math.abs(ratio / doc - 1) <= ASPECT_SLACK
}

/**
 * The share of a side, its ends left out, along which an edge runs: a sample
 * counts when an edge pixel lies within 2 pixels across it with its gradient
 * near the side's normal. Parts outside the picture count as not covered.
 */
function sideSupport(e: Edges, a: Point, b: Point): number {
  const len = distance(a, b)
  if (len < 1) return 0
  const n = Math.max(8, Math.round(len / 2))
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const nx = -uy
  const ny = ux
  let normal = Math.atan2(ny, nx)
  if (normal < 0) normal += Math.PI
  let hit = 0
  let count = 0
  for (let s = 0; s < n; s++) {
    const t = 0.05 + (0.9 * (s + 0.5)) / n
    const px = a.x + (b.x - a.x) * t
    const py = a.y + (b.y - a.y) * t
    count++
    for (let d = -2; d <= 2; d++) {
      const x = Math.round(px + nx * d)
      const y = Math.round(py + ny * d)
      if (x < 0 || y < 0 || x >= e.width || y >= e.height) continue
      const i = y * e.width + x
      if (e.on[i] && angleBetween(e.dir[i]!, normal) <= 15 * DEG) {
        hit++
        break
      }
    }
  }
  return count ? hit / count : 0
}
