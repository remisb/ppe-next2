import type { Employee } from '@ppe/api-client'

/**
 * The sizes Create Order will flag as missing for an employee: a shoe size is
 * never inferred, and a clothing size is suggested from height when there is
 * one. The same rule as the dashboards' "missing a size".
 */
export function missingSizes(e: Pick<Employee, 'clothing_size' | 'shoe_size' | 'height_cm'>): { clothing: boolean; shoes: boolean } {
  return { clothing: e.clothing_size === null && e.height_cm === null, shoes: e.shoe_size === null }
}

export function isMissingASize(e: Pick<Employee, 'clothing_size' | 'shoe_size' | 'height_cm'>): boolean {
  const m = missingSizes(e)
  return m.clothing || m.shoes
}
