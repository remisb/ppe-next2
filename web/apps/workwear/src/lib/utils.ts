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
export function formatSize(size: string | null | undefined): string {
  return size ?? '–'
}

/** Blank input as null, otherwise trimmed. */
export function blankToNull(s: string): string | null {
  const t = s.trim()
  return t === '' ? null : t
}
