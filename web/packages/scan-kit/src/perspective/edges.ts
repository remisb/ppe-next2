/**
 * Edges for finding a page: grey, scaled down, blurred, Sobel's gradient, and
 * the edge pixels kept where the gradient is strong and largest across the
 * edge (non-maximum suppression), so a page's border is one pixel wide.
 */
import type { Grey, Rgba } from './geometry.ts'

export interface Edges {
  width: number
  height: number
  /** The gradient's strength at each pixel. */
  mag: Float32Array
  /** The gradient's direction at each pixel, radians in [0, π): across the edge, the line's normal. */
  dir: Float32Array
  /** 1 where an edge is. */
  on: Uint8Array
}

/** The share of pixels, weakest first, that are never edges. */
const QUIET_SHARE = 0.85

/** A gradient weaker than this is never an edge (Sobel on 0–255; a page on a like background still passes). */
const MIN_STRENGTH = 24

export function greyOf(img: Rgba): Grey {
  const n = img.width * img.height
  const data = new Uint8Array(n)
  const s = img.data
  for (let i = 0, j = 0; i < n; i++, j += 4) data[i] = (s[j]! * 77 + s[j + 1]! * 150 + s[j + 2]! * 29) >> 8
  return { width: img.width, height: img.height, data }
}

/** g with its longest side at most maxSide (each pixel the mean of the box it covers), and the factor used. */
export function shrink(g: Grey, maxSide: number): { grey: Grey; factor: number } {
  const factor = Math.min(1, maxSide / Math.max(g.width, g.height))
  if (factor === 1) return { grey: g, factor }
  const width = Math.max(1, Math.round(g.width * factor))
  const height = Math.max(1, Math.round(g.height * factor))
  const data = new Uint8Array(width * height)
  const fx = g.width / width
  const fy = g.height / height
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * fy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * fx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx))
      let sum = 0
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += g.data[yy * g.width + xx]!
      data[y * width + x] = sum / ((y1 - y0) * (x1 - x0))
    }
  }
  return { grey: { width, height, data }, factor: width / g.width }
}

/** A 5-tap binomial blur (about Gaussian, σ ≈ 1), across then down; edges repeat. */
function blur(g: Grey): Float32Array {
  const { width: w, height: h } = g
  const k = [1, 4, 6, 4, 1]
  const across = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -2; i <= 2; i++) s += k[i + 2]! * g.data[y * w + Math.min(w - 1, Math.max(0, x + i))]!
      across[y * w + x] = s / 16
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -2; i <= 2; i++) s += k[i + 2]! * across[Math.min(h - 1, Math.max(0, y + i)) * w + x]!
      out[y * w + x] = s / 16
    }
  }
  return out
}

export function edgesOf(g: Grey): Edges {
  const { width: w, height: h } = g
  const b = blur(g)
  const mag = new Float32Array(w * h)
  const dir = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = b[i - w + 1]! + 2 * b[i + 1]! + b[i + w + 1]! - b[i - w - 1]! - 2 * b[i - 1]! - b[i + w - 1]!
      const gy = b[i + w - 1]! + 2 * b[i + w]! + b[i + w + 1]! - b[i - w - 1]! - 2 * b[i - w]! - b[i - w + 1]!
      mag[i] = Math.hypot(gx, gy)
      let a = Math.atan2(gy, gx)
      if (a < 0) a += Math.PI
      if (a >= Math.PI) a -= Math.PI
      dir[i] = a
    }
  }
  const cut = Math.max(MIN_STRENGTH, quantile(mag, QUIET_SHARE))
  const on = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const m = mag[i]!
      if (m < cut) continue
      // The neighbours across the edge: along the gradient, at the nearest of 0°, 45°, 90°, 135°.
      const sector = Math.round(dir[i]! / (Math.PI / 4)) % 4
      const step = sector === 0 ? 1 : sector === 1 ? w + 1 : sector === 2 ? w : w - 1
      if (m >= mag[i - step]! && m >= mag[i + step]!) on[i] = 1
    }
  }
  return { width: w, height: h, mag, dir, on }
}

/** The value below which share of the values lie (a histogram of 256 bins). */
function quantile(values: Float32Array, share: number): number {
  let max = 0
  for (const v of values) if (v > max) max = v
  if (max === 0) return 0
  const bins = new Uint32Array(256)
  for (const v of values) bins[Math.min(255, Math.floor((v / max) * 255))]!++
  const target = values.length * share
  let seen = 0
  for (let i = 0; i < 256; i++) {
    seen += bins[i]!
    if (seen >= target) return ((i + 1) / 256) * max
  }
  return max
}
