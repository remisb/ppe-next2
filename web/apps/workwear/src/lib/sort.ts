import type { SizeGroup } from '@ppe/api-client'

// Letter clothing sizes stay on order lines stored before clothing sizes
// became EU numbers (migration 0012); each ranks at the number it converted to.
const letterClothing = new Map([['S', 46], ['M', 50], ['L', 54], ['XL', 58], ['2XL', 62], ['3XL', 66]])

/**
 * An order line's size as a number to sort by, read by its size group, never by
 * whether it looks numeric: clothing 44 and shoe 44 are different sizes.
 * Clothing comes first by EU number, a letter size just after the number it
 * converted to (an old L after 54), then shoes by number. A size its group does
 * not know sorts after the group's known ones; no size is null, so it goes last.
 */
export function sizeRank(group: SizeGroup | '', size: string | null | undefined): number | null {
  if (!size) return null
  const n = Number(size)
  switch (group) {
    case 'CLOTHING': {
      if (Number.isInteger(n)) return n
      const letter = letterClothing.get(size)
      return letter === undefined ? 999 : letter + 0.5
    }
    case 'SHOES':
      return 1000 + (Number.isInteger(n) ? n : 999)
    default:
      return null
  }
}
