import type { CatalogueItem } from '@ppe/api-client'

/**
 * Add Item's search: the items whose name or manufacturer/model contain every
 * word of q, ignoring case, in catalogue (display) order. An empty q is all.
 */
export function matchItems(items: readonly CatalogueItem[], q: string): CatalogueItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...items]
  return items.filter((i) => {
    const text = `${i.name} ${i.details}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
}
