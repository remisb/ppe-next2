import type { ClothingSize } from '@ppe/api-client'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const euro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })

/** Integer cents as a euro amount, e.g. €49.99. Every displayed price carries €. */
export function formatEuro(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '—' : euro.format(cents / 100)
}

/** Parse a euro amount typed by a user ("49.99", "49,99", "€49") into cents. */
export function parseEuro(input: string): number | null {
  const cleaned = input.replace(/[€\s]/g, '').replace(',', '.')
  if (cleaned === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN
  return Math.round(Number(cleaned) * 100)
}

export function formatMonths(months: number | null | undefined): string {
  if (months === null || months === undefined) return '—'
  return months === 1 ? '1 month' : `${months} months`
}

/** A size for tables: no-size items show an en dash. */
export function formatSize(size: string | number | null | undefined): string {
  return size === null || size === undefined ? '–' : String(size)
}

/** A clothing size choice: "46 (160–167 cm)" for a size a height suggests, just "44" for the rest. */
export function clothingSizeLabel(s: ClothingSize): string {
  return s.min_cm === null || s.max_cm === null ? s.code : `${s.code} (${s.min_cm}–${s.max_cm} cm)`
}

/** Blank input as null, otherwise trimmed. */
export function blankToNull(s: string): string | null {
  const t = s.trim()
  return t === '' ? null : t
}
