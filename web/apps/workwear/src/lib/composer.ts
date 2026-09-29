import type { ItemSet, ListedOrder, ResolvedEmployee } from '@ppe/api-client'

import { type ClothingBand, clothingSizeLabel } from './utils'
import type { WorkingLine } from './working-order'

/*
 * What Create Order shows around the lines: the employee's saved sizes (which
 * explain how each line was resolved), their last order, and which item sets
 * are already on the order. Pure, so the screen only renders.
 */

/** One saved size of the employee, or the lack of one. */
export interface SizePart {
  label: string
  /** Nothing saved, so lines of this group need a size picked by hand. */
  missing: boolean
}

/**
 * The saved sizes as short parts: "165 cm", "Clothing S (44–46)", "Shoes 39".
 * Without a clothing size a height still suggests one; without a shoe size
 * nothing does (the resolution rules of manual §4.4).
 */
export function sizeParts(e: Pick<ResolvedEmployee, 'height_cm' | 'clothing_size' | 'shoe_size'>, bands: readonly ClothingBand[]): SizePart[] {
  const parts: SizePart[] = []
  if (e.height_cm !== null) parts.push({ label: `${e.height_cm} cm`, missing: false })
  if (e.clothing_size !== null) {
    parts.push({ label: `Clothing ${clothingSizeLabel(bands, e.clothing_size)}`, missing: false })
  } else {
    parts.push(e.height_cm !== null ? { label: 'Clothing from height', missing: false } : { label: 'No clothing size', missing: true })
  }
  parts.push(e.shoe_size !== null ? { label: `Shoes ${e.shoe_size}`, missing: false } : { label: 'No shoe size', missing: true })
  return parts
}

/** The employee's most recent order by the date it was ordered, if any. */
export function lastOrder(orders: readonly ListedOrder[]): ListedOrder | undefined {
  let last: ListedOrder | undefined
  for (const o of orders) if (!last || o.ordered_at > last.ordered_at) last = o
  return last
}

/** Every item of the set is on the order already: applying it again would add to those lines. */
export function setOnOrder(set: Pick<ItemSet, 'lines'>, lines: readonly Pick<WorkingLine, 'catalogueItemId'>[]): boolean {
  if (set.lines.length === 0) return false
  const on = new Set(lines.map((l) => l.catalogueItemId))
  return set.lines.every((l) => on.has(l.catalogue_item_id))
}

/** "5 lines", "1 line". */
export function linesText(n: number): string {
  return `${n} ${n === 1 ? 'line' : 'lines'}`
}

const REVIEW_LINK_KEY = 'workwear.review-link'

/** Whether the review sheet creates the confirmation link as well: on unless this device turned it off. */
export function loadCreateLink(): boolean {
  try {
    return globalThis.localStorage?.getItem(REVIEW_LINK_KEY) !== 'off'
  } catch {
    return true
  }
}

/** Remembers the choice on this device, a convenience only. */
export function saveCreateLink(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(REVIEW_LINK_KEY, on ? 'on' : 'off')
  } catch {
    // Not remembered; the sheet still works.
  }
}
