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

/** One clothing size choice: a letter band of two EU sizes, "S (44–46)". */
export interface ClothingBand {
  /** The band's larger size, the one a pick stores (and a height suggests). */
  value: string
  label: string
  codes: string[]
}

/** The clothing vocabulary as the six choices size pickers offer, smallest first. */
export function clothingBands(sizes: ClothingSize[]): ClothingBand[] {
  const byBand = new Map<string, string[]>()
  for (const s of sizes) byBand.set(s.band, [...(byBand.get(s.band) ?? []), s.code])
  return [...byBand].map(([band, codes]) => ({ value: codes.at(-1)!, label: `${band} (${codes[0]}–${codes.at(-1)})`, codes }))
}

/**
 * The picker value for a saved size: its band's. A size that is the band's
 * smaller one still shows as its band, and keeps its number until another band is picked.
 */
export function clothingBandValue(bands: ClothingBand[], code: string | number | null | undefined): string {
  if (code === null || code === undefined || code === '') return ''
  const c = String(code)
  return bands.find((b) => b.codes.includes(c))?.value ?? c
}

/** Blank input as null, otherwise trimmed. */
export function blankToNull(s: string): string | null {
  const t = s.trim()
  return t === '' ? null : t
}
