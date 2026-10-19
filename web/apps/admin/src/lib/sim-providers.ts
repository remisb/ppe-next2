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
