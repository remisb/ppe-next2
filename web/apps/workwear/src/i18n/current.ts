/**
 * The interface language in use. It lives in its own module so the
 * dictionaries' plural helper can read it without importing the dictionaries.
 */
export type Lang = 'en' | 'lt' | 'ru'

let current: Lang = 'en'

export function currentLang(): Lang {
  return current
}

export function setCurrentLang(lang: Lang): void {
  current = lang
}

/** The Intl locale for dates, numbers and plurals in each language. */
export const intlLocales: Record<Lang, string> = { en: 'en-GB', lt: 'lt-LT', ru: 'ru-RU' }

export function intlLocale(): string {
  return intlLocales[current]
}
