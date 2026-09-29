/**
 * The staff app's interface text in English, Lithuanian and Russian. Each
 * language is one typed dictionary split into namespaces (i18n/<lang>/<ns>.ts);
 * the Lithuanian and Russian ones are typed against the English, so a missing
 * or misspelt key fails the typecheck. Counted phrases are functions that use
 * `plural` (Intl.PluralRules), so each language picks its own form.
 *
 * Read the text in use through `t` (t.history.title, t.common.days(3)). It is
 * a live binding: `setLanguage` swaps it, and the app remounts on a change
 * (lib/api.tsx), so nothing rendered keeps the old language. Pure functions
 * may read `t` too; tests run in English.
 *
 * Only the staff app is translated. The employee's confirmation page and
 * hand-over mode keep their own EN / RU switch (lib/confirm-text.ts), and the
 * Items Given Record stays bilingual English / Russian, as the manual defines.
 */
import { type Lang, intlLocales, setCurrentLang } from './current'
import { en } from './en'
import { lt } from './lt'
import { ru } from './ru'

export type { Lang } from './current'
export { currentLang, intlLocale } from './current'
export { plural } from './plural'

export type Messages = typeof en

const dictionaries: Record<Lang, Messages> = { en, lt, ru }

/** The languages a user can choose, each named in itself. */
export const languages: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'lt', label: 'Lietuvių' },
  { value: 'ru', label: 'Русский' },
]

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'lt' || v === 'ru'
}

/** The text in use. Reassigned by setLanguage; importers see the new value. */
export let t: Messages = en

/** Switches the text, number and date formats, and <html lang>, to lang. */
export function setLanguage(lang: Lang): void {
  setCurrentLang(lang)
  t = dictionaries[lang]
  const root = globalThis.document?.documentElement
  if (root) root.lang = intlLocales[lang].slice(0, 2)
}

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
