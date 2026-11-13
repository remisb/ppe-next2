/**
 * Scan Document's expected page: where ICAO puts the document around the MRZ
 * band the reader found. The band's width gives the scale, its centre and
 * turn the place; @ppe/scan-kit's findPage then looks for each side near
 * where this puts it. Pure, tested.
 */
import type { BandPlace } from '@ppe/mrz/reader'
import type { Quad } from '@ppe/scan-kit/perspective'

import { DOC_MM, FORMAT_MM } from './document-geometry'
import type { DocType } from './flow'

/** The document's 4 corners, in the pixels of a width × height picture the band was found in. */
export function pageQuad(band: BandPlace, width: number, height: number): Quad {
  const doc = FORMAT_MM[band.format]
  const mm = (band.size.width * width) / doc.band.width
  const a = (band.angle * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const cx = band.centre.x * width
  const cy = band.centre.y * height
  const at = (x: number, y: number) => {
    const dx = x - doc.band.cx
    const dy = y - doc.band.cy
    return { x: cx + (dx * cos - dy * sin) * mm, y: cy + (dx * sin + dy * cos) * mm }
  }
  return [at(0, 0), at(doc.w, 0), at(doc.w, doc.h), at(0, doc.h)]
}

/** The document's width over its height: from the band's format when one was read, else from the type chosen. */
export function aspectOf(format: BandPlace['format'] | undefined, type: DocType): number {
  const d = format ? FORMAT_MM[format] : DOC_MM[type]
  return d.w / d.h
}
