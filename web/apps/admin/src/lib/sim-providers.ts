import type { SimProvider } from '@ppe/api-client'
import { euroInput, parseEuro } from '@ppe/i18n'

/**
 * The Settings list of SIM providers, kept as a draft until saved: the
 * same rules the server applies (internal/domain/settings). Names are trimmed,
 * each listed once whatever its case, at most 100 characters and 50 names; the
 * default is one of them or none. Each provider has an optional e-mail, the
 * address its activation and blocking emails go to, and an optional default
 * plan. The server has the last word.
 */
export interface SimProviders {
  providers: SimProvider[]
  /** The name of one of providers, or '' for none. */
  default: string
}

export const MAX_PROVIDER_LENGTH = 100
export const MAX_PROVIDERS = 50

export type ProviderProblem = 'empty' | 'duplicate' | 'tooLong' | 'tooMany'

/** Why name cannot be added to the list, or undefined when it can. */
export function providerProblem(list: readonly SimProvider[], name: string): ProviderProblem | undefined {
  const n = name.trim()
  if (!n) return 'empty'
  if (n.length > MAX_PROVIDER_LENGTH) return 'tooLong'
  if (list.some((p) => p.name.toLowerCase() === n.toLowerCase())) return 'duplicate'
  if (list.length >= MAX_PROVIDERS) return 'tooMany'
  return undefined
}

/** The list with name added at the end, with no e-mail or plan; the first one added becomes the default when there is none. */
export function withProvider(s: SimProviders, name: string): SimProviders {
  const n = name.trim()
  return { providers: [...s.providers, { name: n, email: '', default_plan: '' }], default: s.default || (s.providers.length === 0 ? n : '') }
}

/** The list without name; removing the default leaves none. */
export function withoutProvider(s: SimProviders, name: string): SimProviders {
  return { providers: s.providers.filter((p) => p.name !== name), default: s.default === name ? '' : s.default }
}

/** The list with the e-mail or plan of the provider name changed, as typed. */
export function withDetails(s: SimProviders, name: string, change: Partial<Pick<SimProvider, 'email' | 'default_plan'>>): SimProviders {
  return { ...s, providers: s.providers.map((p) => (p.name === name ? { ...p, ...change } : p)) }
}

/** The list as it is saved: each e-mail and plan trimmed. */
export function tidyProviders(s: SimProviders): SimProviders {
  return { ...s, providers: s.providers.map((p) => ({ name: p.name, email: p.email.trim(), default_plan: p.default_plan.trim() })) }
}

export function sameProviders(a: SimProviders, b: SimProviders): boolean {
  const x = tidyProviders(a).providers
  const y = tidyProviders(b).providers
  return (
    a.default === b.default &&
    x.length === y.length &&
    x.every((p, i) => p.name === y[i]!.name && p.email === y[i]!.email && p.default_plan === y[i]!.default_plan)
  )
}

/** An e-mail address's limit (RFC 5321's path), the server's own. */
export const MAX_EMAIL_LENGTH = 254

/**
 * Whether email can be saved as a provider's address: empty (none), or one
 * bare address, such as sim@provider.lt, with a dot in its domain. The server
 * checks it too.
 */
export function emailOk(email: string): boolean {
  const e = email.trim()
  return e === '' || (e.length <= MAX_EMAIL_LENGTH && /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/.test(e))
}

/** The names of the providers whose e-mail cannot be saved. */
export function badEmails(s: SimProviders): string[] {
  return s.providers.filter((p) => !emailOk(p.email)).map((p) => p.name)
}

/** A provider's default plan's limit, a SIM card's plan's own (internal/domain/asset). */
export const MAX_PLAN_LENGTH = 100

/** The default Non-return Value's limit, an asset's own (internal/domain/asset). */
export const MAX_VALUE_CENTS = 100_000_000_00

export type ValueProblem = 'invalid' | 'tooLarge'

/** A saved default Non-return Value as the field shows it: 25.00, or empty for none. */
export function valueText(cents: number | null | undefined): string {
  return euroInput(cents)
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
