import type { CatalogueItem, Employee, ItemSet } from '@ppe/api-client'

import { missingSizes } from './missing-sizes'

/*
 * What the record lists (Employees, Item Catalogue, Item Sets) show in a row:
 * a list is for finding a record, its page for acting on it. Pure, so the
 * screens only render.
 */

/** "AI" for Aleksandr Ivanov: the row's avatar. */
export function initials(e: Pick<Employee, 'first_name' | 'last_name'>): string {
  return `${e.first_name.trim().charAt(0)}${e.last_name.trim().charAt(0)}`.toUpperCase()
}

/** A row's second line: "W-006 · 189 cm · Clothing 54 · Shoes 46". A missing size is left out; the row flags it. */
export function employeeFacts(e: Pick<Employee, 'code' | 'height_cm' | 'clothing_size' | 'shoe_size'>): string {
  return [
    e.code,
    e.height_cm !== null ? `${e.height_cm} cm` : null,
    e.clothing_size !== null ? `Clothing ${e.clothing_size}` : null,
    e.shoe_size !== null ? `Shoes ${e.shoe_size}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The sizes Create Order will ask for, in a few words, or undefined when it asks for none. */
export function missingLabel(e: Pick<Employee, 'clothing_size' | 'shoe_size' | 'height_cm'>): string | undefined {
  const m = missingSizes(e)
  if (m.clothing && m.shoes) return 'No sizes'
  if (m.clothing) return 'No clothing size'
  if (m.shoes) return 'No shoe size'
  return undefined
}

export type ItemStatus = 'active' | 'incomplete' | 'inactive'

/**
 * One status per item, for the Catalogue's chips: inactive (not offered),
 * incomplete (offered, but Mark as Ordered refuses it without a price and a
 * service period) or active.
 */
export function itemStatus(i: Pick<CatalogueItem, 'active' | 'unit_price_cents' | 'service_period_months'>): ItemStatus {
  if (!i.active) return 'inactive'
  return i.unit_price_cents === null || i.service_period_months === null ? 'incomplete' : 'active'
}

export interface SetTotal {
  /** Lines of the set. */
  items: number
  /** Default quantities at current catalogue prices. */
  cents: number
  /** False when an item has no price (or is gone), so the total leaves it out. */
  complete: boolean
}

/** What a set comes to at today's prices: "3 items · €274.90". Applying it resolves prices again. */
export function setTotal(set: Pick<ItemSet, 'lines'>, itemsById: ReadonlyMap<string, Pick<CatalogueItem, 'unit_price_cents'>>): SetTotal {
  let cents = 0
  let complete = true
  for (const l of set.lines) {
    const price = itemsById.get(l.catalogue_item_id)?.unit_price_cents ?? null
    if (price === null) complete = false
    else cents += price * l.default_quantity
  }
  return { items: set.lines.length, cents, complete }
}
