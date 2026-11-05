/**
 * Settings → AI and AI Usage's money (ADR 0007): the ledger counts in
 * micro-dollars, as OpenAI bills in USD; the screens show and take dollars.
 */
import { intlLocale } from '@ppe/i18n'

/** Micro-dollars as dollars, with cents (and more for a call's few tenths of a cent). */
export function formatUSD(micro: number, fine = false): string {
  return new Intl.NumberFormat(intlLocale(), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: fine ? 4 : 2,
  }).format(micro / 1e6)
}

/** Dollars as typed (a comma or a point), as micro-dollars; null for empty, undefined for not a sum. */
export function microFromUSD(text: string): number | null | undefined {
  const t = text.trim().replace(/\s/g, '').replace(',', '.').replace(/^\$/, '')
  if (t === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined
  return Math.round(Number(t) * 1e6)
}

/** Micro-dollars as the budget field shows them: plain dollars and cents. */
export function usdInput(micro: number | null): string {
  return micro === null ? '' : (micro / 1e6).toFixed(2)
}

/** How much of the budget is spent, 0–1; null without a budget. */
export function budgetShare(spent: number, budget: number | null): number | null {
  if (budget === null) return null
  if (budget === 0) return 1
  return Math.min(1, spent / budget)
}

/** A price as typed, in dollars a million tokens (0 to 10 000); undefined for not one. */
export function priceOf(text: string | undefined): number | undefined {
  const t = (text ?? '').trim().replace(',', '.')
  if (!/^\d+(\.\d{1,4})?$/.test(t)) return undefined
  const n = Number(t)
  return n <= 10_000 ? n : undefined
}

/** The n months (YYYY-MM) up to and including last, oldest first. */
export function monthsTo(last: string, n: number): string[] {
  const [y, m] = last.split('-').map(Number) as [number, number]
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/** A call's tokens, all kinds together. */
export function totalTokens(t: { input_text: number; input_image: number; output_text: number; output_image: number }): number {
  return t.input_text + t.input_image + t.output_text + t.output_image
}
