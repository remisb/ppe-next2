/**
 * The portrait's crop (docs-import plan FR-11, §5.2): where it starts, and
 * how the box moves and resizes. Boxes are fractions of the picture's width
 * and height; the portrait is 3:4 (width to height) in the picture's own
 * pixels, so a box's height in fractions depends on the picture's aspect.
 * Pure functions, tested; the crop editor only wires pointers and keys.
 */
import type { BandPlace } from '@ppe/mrz/reader'

import type { Box, DocType } from './flow'

/** The portrait's width over its height, in pixels: ICAO's 35 × 45 mm, near enough 3:4. */
export const PORTRAIT_RATIO = 3 / 4

/** Each document's size, mm (ICAO). */
const DOC_MM: Record<DocType, { w: number; h: number }> = { passport: { w: 125, h: 88 }, card: { w: 85.6, h: 54 } }

/**
 * Where the portrait is on each document, mm from its top left: ICAO's zone
 * for it, a little generous so the whole face is in. A card's is on its front.
 */
const PORTRAIT_MM: Record<DocType, { x: number; y: number; w: number }> = {
  passport: { x: 5, y: 12, w: 35 },
  card: { x: 3, y: 7.5, w: 27 },
}

/** A passport page's MRZ band, as the reader finds it: its centre, and its width with the reader's margins. */
const TD3_BAND = { cx: 62.5, cy: 78, width: 44 * 2.54 + 4 }

/** The portrait's height for a width, both fractions, in a picture of this aspect (width over height). */
function heightFor(w: number, aspect: number): number {
  return (w * aspect) / PORTRAIT_RATIO
}

/** The box, kept whole inside the picture: shrunk if it is larger, then moved in. */
export function fitBox(box: Box, aspect: number): Box {
  let w = box.w
  let h = box.h
  if (h > 1) {
    h = 1
    w = (h * PORTRAIT_RATIO) / aspect
  }
  if (w > 1) {
    w = 1
    h = heightFor(w, aspect)
  }
  const x = Math.min(Math.max(box.x, 0), 1 - w)
  const y = Math.min(Math.max(box.y, 0), 1 - h)
  return { x, y, w, h }
}

/**
 * Where the portrait starts. On a passport page whose MRZ band was found,
 * from the band: its width gives the page's scale, its centre and turn where
 * the page is, and the portrait is where ICAO puts it. Otherwise (a card's
 * front, or a picture the live view took inside its guide) the document is
 * taken to fill the picture.
 */
export function portraitBox(type: DocType, aspect: number, band?: BandPlace): Box {
  const zone = PORTRAIT_MM[type]
  if (type === 'passport' && band && band.format === 'TD3') {
    // In units of the picture's height: its width is `aspect`.
    const mm = (band.size.width * aspect) / TD3_BAND.width
    const a = (band.angle * Math.PI) / 180
    const dx = zone.x + zone.w / 2 - TD3_BAND.cx
    const dy = zone.y + zone.w / PORTRAIT_RATIO / 2 - TD3_BAND.cy
    const cx = band.centre.x * aspect + (dx * Math.cos(a) - dy * Math.sin(a)) * mm
    const cy = band.centre.y + (dx * Math.sin(a) + dy * Math.cos(a)) * mm
    const w = (zone.w * mm) / aspect
    const h = heightFor(w, aspect)
    return fitBox({ x: cx / aspect - w / 2, y: cy - h / 2, w, h }, aspect)
  }
  const doc = DOC_MM[type]
  const w = zone.w / doc.w
  return fitBox({ x: zone.x / doc.w, y: zone.y / doc.h, w, h: heightFor(w, aspect) }, aspect)
}

/** The box moved by dx and dy (fractions), kept inside. */
export function moveBox(box: Box, dx: number, dy: number, aspect: number): Box {
  return fitBox({ ...box, x: box.x + dx, y: box.y + dy }, aspect)
}

/** The box resized to width w (a fraction), about its centre, 3:4 kept, no smaller than a tenth of the picture. */
export function resizeBox(box: Box, w: number, aspect: number): Box {
  const width = Math.max(0.1, w)
  const h = heightFor(width, aspect)
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  return fitBox({ x: cx - width / 2, y: cy - h / 2, w: width, h }, aspect)
}

/** The box in a picture's pixels, whole numbers, for drawing it out. */
export function cropRect(box: Box, width: number, height: number): { x: number; y: number; w: number; h: number } {
  return { x: Math.round(box.x * width), y: Math.round(box.y * height), w: Math.round(box.w * width), h: Math.round(box.h * height) }
}

/** The portrait's size as saved: about 600 × 800 (FR-11), never larger than the crop. */
export const PORTRAIT_WIDTH = 600
