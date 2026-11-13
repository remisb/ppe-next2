/**
 * Where things are on an identity document, mm (ICAO Doc 9303): the
 * document's size, the portrait's zone, and the MRZ band as the reader finds
 * it (its centre, and its width with the reader's margins). The portrait's
 * crop (portrait.ts) and Scan Document's expected page (page-box.ts) both
 * place the document from the band.
 */
import type { BandPlace } from '@ppe/mrz/reader'

import type { DocType } from './flow'

/** Each document's size, mm. */
export const DOC_MM: Record<DocType, { w: number; h: number }> = { passport: { w: 125, h: 88 }, card: { w: 85.6, h: 54 } }

/**
 * Where the portrait is on each document, mm from its top left: ICAO's zone
 * for it, a little generous so the whole face is in. A card's is on its front.
 */
export const PORTRAIT_MM: Record<DocType, { x: number; y: number; w: number }> = {
  passport: { x: 5, y: 12, w: 35 },
  card: { x: 3, y: 7.5, w: 27 },
}

/** The reader's band width: the line's characters at 2.54 mm, and 2 mm either side. */
const bandWidth = (chars: number) => chars * 2.54 + 4

/** A passport page's MRZ band, as the reader finds it: its centre, and its width with the reader's margins. */
export const TD3_BAND = { cx: 62.5, cy: 78, width: bandWidth(44) }

/**
 * Each MRZ format's document and band: TD3 a passport's page (125 × 88), TD2
 * an A7 document (105 × 74), TD1 a card's back (85.6 × 54), its 3 lines at the bottom.
 */
export const FORMAT_MM: Record<BandPlace['format'], { w: number; h: number; band: { cx: number; cy: number; width: number } }> = {
  TD3: { w: 125, h: 88, band: TD3_BAND },
  TD2: { w: 105, h: 74, band: { cx: 52.5, cy: 66, width: bandWidth(36) } },
  TD1: { w: 85.6, h: 54, band: { cx: 42.8, cy: 45.5, width: bandWidth(30) } },
}
