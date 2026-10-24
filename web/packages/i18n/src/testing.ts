/**
 * Checks for dictionaries, for each app's and package's tests: every language
 * has every English text, none empty and none left in English.
 */

/**
 * Every text in a dictionary, by its path, with functions called on sample
 * values; a function that returns words in parts ({ title, detail }) gives
 * each part its own path.
 */
export function texts(dict: object, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${k}` : k
    const value: unknown = typeof v === 'function' ? (v as (...a: unknown[]) => unknown)(...Array.from({ length: v.length }, () => 7)) : v
    if (value && typeof value === 'object') for (const [p, s] of texts(value, path)) out.set(p, s)
    else out.set(path, String(value))
  }
  return out
}

/** The same in every language: names of things that are not translated. */
export const sameEverywhere = new Set(['WhatsApp', 'SIM', 'Email', 'E-mail', '⌘K', 'OK', 'API', 'PostgreSQL', 'SHA-256'])

export interface DictionaryProblems {
  /** Paths in one dictionary and not the other. */
  missing: string[]
  extra: string[]
  empty: string[]
  /** Texts identical to the English, which are almost always left untranslated. */
  untranslated: string[]
}

/** What is wrong with translated against the English one. */
export function dictionaryProblems(english: object, translated: object): DictionaryProblems {
  const en = texts(english)
  const tr = texts(translated)
  return {
    missing: [...en.keys()].filter((k) => !tr.has(k)).sort(),
    extra: [...tr.keys()].filter((k) => !en.has(k)).sort(),
    empty: [...tr].filter(([, s]) => s.trim() === '').map(([k]) => k),
    untranslated: [...tr].filter(([k, s]) => s === en.get(k) && /[A-Za-z]{3}/.test(s) && !sameEverywhere.has(s)).map(([k]) => k),
  }
}

export const noProblems: DictionaryProblems = { missing: [], extra: [], empty: [], untranslated: [] }
