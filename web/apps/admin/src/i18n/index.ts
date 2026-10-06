/**
 * Administration's text in English, Lithuanian and Russian, as the staff
 * app's (see apps/workwear/src/i18n): one typed dictionary per language,
 * split into namespaces, read through the live `t`. The words of sign-in,
 * the shared components and backups' verdict are their packages'.
 */
import { type Lang, applyLanguage } from '@ppe/i18n'

import { en } from './en'
import { lt } from './lt'
import { ru } from './ru'

export { type Lang, currentLang, intlLocale, plural } from '@ppe/i18n'

export type Messages = typeof en

const dictionaries: Record<Lang, Messages> = { en, lt, ru }

/** The text in use. Reassigned by setLanguage; importers see the new value. */
export let t: Messages = en

/** Switches the text, number and date formats, and <html lang>, to lang. */
export function setLanguage(lang: Lang): void {
  applyLanguage(lang)
  t = dictionaries[lang]
}
