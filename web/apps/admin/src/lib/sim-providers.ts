import { parseEuro } from '@ppe/i18n'

/**
 * The Settings list of SIM providers, kept as a draft until saved: the
 * same rules the server applies (internal/domain/settings). Names are trimmed,
 * each listed once whatever its case, at most 100 characters and 50 names; the
 * default is one of them or none. The server has the last word.
 */
export interface SimProviders {
  providers: string[]
  /** One of providers, or '' for none. */
  default: string
}

export const MAX_PROVIDER_LENGTH = 100
export const MAX_PROVIDERS = 50

export type ProviderProblem = 'empty' | 'duplicate' | 'tooLong' | 'tooMany'

/** Why name cannot be added to the list, or undefined when it can. */
export function providerProblem(list: readonly string[], name: string): ProviderProblem | undefined {
  const n = name.trim()
  if (!n) return 'empty'
  if (n.length > MAX_PROVIDER_LENGTH) return 'tooLong'
  if (list.some((p) => p.toLowerCase() === n.toLowerCase())) return 'duplicate'
  if (list.length >= MAX_PROVIDERS) return 'tooMany'
  return undefined
}

/** The list with name added at the end; the first one added becomes the default when there is none. */
export function withProvider(s: SimProviders, name: string): SimProviders {
  const n = name.trim()
  return { providers: [...s.providers, n], default: s.default || (s.providers.length === 0 ? n : '') }
}

/** The list without name; removing the default leaves none. */
export function withoutProvider(s: SimProviders, name: string): SimProviders {
  return { providers: s.providers.filter((p) => p !== name), default: s.default === name ? '' : s.default }
}

export function sameProviders(a: SimProviders, b: SimProviders): boolean {
  return a.default === b.default && a.providers.length === b.providers.length && a.providers.every((p, i) => p === b.providers[i])
}

/** The default plan's limit, a SIM card's plan's own (internal/domain/asset). */
export const MAX_PLAN_LENGTH = 100

/** The default Non-return Value's limit, an asset's own (internal/domain/asset). */
export const MAX_VALUE_CENTS = 100_000_000_00

export type ValueProblem = 'invalid' | 'tooLarge'

/** A saved default Non-return Value as the field shows it: 25.00, or empty for none. */
export function valueText(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '' : (cents / 100).toFixed(2)
}

/** Why the typed default Non-return Value cannot be saved, or undefined when it can (empty is none). */
export function valueProblem(text: string): ValueProblem | undefined {
  const cents = parseEuro(text)
  if (cents === null) return undefined
  if (Number.isNaN(cents)) return 'invalid'
  return cents > MAX_VALUE_CENTS ? 'tooLarge' : undefined
}

/** Whether two typed values are the same amount ("25", "25,00"), or the same text when one is not an amount. */
export function sameValue(a: string, b: string): boolean {
  const x = parseEuro(a)
  const y = parseEuro(b)
  return Number.isNaN(x) || Number.isNaN(y) ? a.trim() === b.trim() : x === y
}
