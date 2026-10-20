import { type Lang, currentLang } from './current.ts'

// Irish English writes €49.99; Lithuanian and Russian 49,99 €.
const euroLocales: Record<Lang, string> = { en: 'en-IE', lt: 'lt-LT', ru: 'ru-RU' }
const euros = new Map<Lang, Intl.NumberFormat>()

/** Integer cents as a euro amount in the language in use, e.g. €49.99 or 49,99 €. Every displayed price carries €. */
export function formatEuro(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '–'
  const lang = currentLang()
  let f = euros.get(lang)
  if (!f) euros.set(lang, (f = new Intl.NumberFormat(euroLocales[lang], { style: 'currency', currency: 'EUR' })))
  return f.format(cents / 100)
}

/** A euro amount typed by a user ("49.99", "49,99", "€49") in cents; null when empty, NaN when not an amount. */
export function parseEuro(input: string): number | null {
  const cleaned = input.replace(/[€\s]/g, '').replace(',', '.')
  if (cleaned === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN
  return Math.round(Number(cleaned) * 100)
}
