import type { CatalogueIcon, CatalogueItem } from '@ppe/api-client'

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

/** Name keywords per pictogram, first match wins; the same list the migration used for existing items. */
const iconWords: [RegExp, CatalogueIcon][] = [
  [/shoe|boot/i, 'shoes'],
  [/jacket|coat|parka/i, 'jacket'],
  [/trouser|pants|overall/i, 'trousers'],
  [/vest/i, 'vest'],
  [/glove/i, 'gloves'],
  [/helmet|hard hat|cap/i, 'helmet'],
  [/glass|goggle|visor/i, 'glasses'],
  [/ear|hearing/i, 'ear'],
  [/mask|respirator/i, 'mask'],
]

/** The pictogram a new item's name suggests, until someone picks one; 'other' when nothing matches. */
export function guessIcon(name: string): CatalogueIcon {
  return iconWords.find(([re]) => re.test(name))?.[1] ?? 'other'
}
