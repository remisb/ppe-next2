/**
 * Flattening a page: each pixel of the output rectangle is taken from where
 * the perspective transform puts it in the photo, bilinear between the 4
 * pixels around it; outside the photo is white.
 */
import { rectQuad, sidesOf, type Quad, type Rgba } from './geometry.ts'
import { homography, mapPoint } from './homography.ts'

export interface PageSizeOptions {
  /** The document's width over its height (125 / 88 for a passport page), when known. */
  aspect?: number
  /** The output's longest side at most. */
  maxSide?: number
}

/**
 * The flattened page's size: from the document's shape when it is known, its
 * long side along the quad's longer one; else the means of the quad's
 * opposite sides. Never larger than maxSide.
 */
export function pageSize(corners: Quad, o: PageSizeOptions = {}): { width: number; height: number } {
  let { width, height } = sidesOf(corners)
  if (o.aspect && o.aspect > 0) {
    const long = Math.max(o.aspect, 1 / o.aspect)
    if (width >= height) height = width / long
    else width = height / long
  }
  const scale = o.maxSide ? Math.min(1, o.maxSide / Math.max(width, height)) : 1
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** The page inside corners, flattened to a width × height picture. */
export function warpPage(img: Rgba, corners: Quad, size: { width: number; height: number }): Rgba {
  const { width, height } = size
  const m = homography(rectQuad(width, height), corners)
  const out = new Uint8ClampedArray(width * height * 4)
  const src = img.data
  const sw = img.width
  const sh = img.height
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = mapPoint(m, { x: x + 0.5, y: y + 0.5 })
      const fx = p.x - 0.5
      const fy = p.y - 0.5
      const o = (y * width + x) * 4
      if (!(fx >= -0.5 && fy >= -0.5 && fx <= sw - 0.5 && fy <= sh - 0.5)) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255
        continue
      }
      const x0 = Math.min(sw - 1, Math.max(0, Math.floor(fx)))
      const y0 = Math.min(sh - 1, Math.max(0, Math.floor(fy)))
      const x1 = Math.min(sw - 1, x0 + 1)
      const y1 = Math.min(sh - 1, y0 + 1)
      const ax = Math.min(1, Math.max(0, fx - x0))
      const ay = Math.min(1, Math.max(0, fy - y0))
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c]! + (src[i10 + c]! - src[i00 + c]!) * ax
        const bottom = src[i01 + c]! + (src[i11 + c]! - src[i01 + c]!) * ax
        out[o + c] = top + (bottom - top) * ay
      }
    }
  }
  return { width, height, data: out }
}
