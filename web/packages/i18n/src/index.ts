/**
 * The interface languages: English, Lithuanian and Russian. The language in
 * use is one value (current.ts) that every app and package reads, so number
 * and date formats, counted phrases and each package's own words switch
 * together. An app keeps its words in typed dictionaries per language and
 * reads them through its own live `t`; a package that draws text keeps a
 * small dictionary of its own (`localized`). Apps remount on a change, so
 * nothing rendered keeps the old language.
 */
import { type Lang, currentLang, intlLocales, setCurrentLang } from './current.ts'

export { type Lang, currentLang, intlLocale, intlLocales } from './current.ts'
export { type PluralForms, plural } from './plural.ts'
export { formatEuro } from './money.ts'

/** The languages a user can choose, each named in itself. */
export const languages: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'lt', label: 'Lietuvių' },
  { value: 'ru', label: 'Русский' },
]

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'lt' || v === 'ru'
}

/** Switches the language in use, and <html lang>, to lang. Apps call it through their own setLanguage, which swaps their `t` too. */
export function applyLanguage(lang: Lang): void {
  setCurrentLang(lang)
  const root = globalThis.document?.documentElement
  if (root) root.lang = intlLocales[lang].slice(0, 2)
}

/**
 * A package's own words in each language, read in the language in use:
 * `const text = localized({ en, lt, ru })`, then `text().close` when drawing.
 * Never read at module level.
 */
export function localized<M>(dicts: Record<Lang, M>): () => M {
  return () => dicts[currentLang()]
}

/** Shared by every app on the origin, so the sign-in screen opens in the last language used here. */
const DEVICE_KEY = 'workwear.language'

/**
 * The language before anyone signs in: the one last used on this device,
 * else the browser's if it is Lithuanian or Russian, else English.
 */
export function deviceLanguage(): Lang {
  try {
    const saved = globalThis.localStorage?.getItem(DEVICE_KEY)
    if (isLang(saved)) return saved
  } catch {
    // Storage unavailable: fall through to the browser's language.
  }
  const browser = globalThis.navigator?.language?.slice(0, 2)
  return isLang(browser) ? browser : 'en'
}

/** Remembers the signed-in user's language for the sign-in screen next time. */
export function rememberDeviceLanguage(lang: Lang): void {
  try {
    globalThis.localStorage?.setItem(DEVICE_KEY, lang)
  } catch {
    // Not remembered; the sign-in screen falls back to the browser's language.
  }
}
