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
import { type Lang, applyLanguage } from '@ppe/i18n'

import { en } from './en'
import { lt } from './lt'
import { ru } from './ru'

export {
  type Lang,
  currentLang,
  deviceLanguage,
  intlLocale,
  isLang,
  languages,
  plural,
  rememberDeviceLanguage,
} from '@ppe/i18n'

export type Messages = typeof en

const dictionaries: Record<Lang, Messages> = { en, lt, ru }

/** The text in use. Reassigned by setLanguage; importers see the new value. */
export let t: Messages = en

/** Switches the text, number and date formats, and <html lang>, to lang. */
export function setLanguage(lang: Lang): void {
  applyLanguage(lang)
  t = dictionaries[lang]
}
