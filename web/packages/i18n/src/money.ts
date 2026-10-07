import { type Lang, currentLang } from './current.ts'

// Irish English writes €49.99; Lithuanian and Russian 49,99 €.
const euroLocales: Record<Lang, string> = { en: 'en-IE', lt: 'lt-LT', ru: 'ru-RU' }
const euros = new Map<Lang, Intl.NumberFormat>()

/** Integer cents as a euro amount in the language in use, e.g. €49.99 or 49,99 €. Every displayed price carries €. */
export function formatEuro(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  const lang = currentLang()
  let f = euros.get(lang)
  if (!f) euros.set(lang, (f = new Intl.NumberFormat(euroLocales[lang], { style: 'currency', currency: 'EUR' })))
  return f.format(cents / 100)
}
