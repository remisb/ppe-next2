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

// The locked documents (the Items Given Record, the assignment form) print € in
// Irish English whatever the screen's language, so a document reads the same everywhere.
const documentEuro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })

/** Integer cents as a locked document prints them: €49.99, in any language. */
export function formatDocumentEuro(cents: number): string {
  return documentEuro.format(cents / 100)
}

/** Integer cents as an amount field shows them for editing: 49.99, or empty for none. parseEuro reads it back. */
export function euroInput(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '' : (cents / 100).toFixed(2)
}

/** A euro amount typed by a user ("49.99", "49,99", "€49") in cents; null when empty, NaN when not an amount. */
export function parseEuro(input: string): number | null {
  const cleaned = input.replace(/[€\s]/g, '').replace(',', '.')
  if (cleaned === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN
  return Math.round(Number(cleaned) * 100)
}
