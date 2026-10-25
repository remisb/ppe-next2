import type { ItemSet, ListedOrder } from '@ppe/api-client'

import { t } from '@/i18n'

import type { WorkingLine } from './working-order'

/*
 * What Create Order shows around the lines: the employee's last order, and
 * which item sets are already on the order. Pure, so the screen only renders.
 */

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
  return t.common.lines(n)
}
