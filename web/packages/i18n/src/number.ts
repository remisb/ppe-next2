import { intlLocale } from './current.ts'

/** A count as the language in use writes it: 12,345 (en), 12 345 (lt, ru). */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat(intlLocale()).format(n)
}
