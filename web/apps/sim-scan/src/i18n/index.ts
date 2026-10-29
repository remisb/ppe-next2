/**
 * The trial app's text in English, Lithuanian and Russian, as the staff
 * app's (see apps/workwear/src/i18n): one typed dictionary per language, read
 * through the live `t`. Its screens' words are @ppe/sim-scan's, which move
 * into the staff app with them.
 */
import { type Lang, applyLanguage } from '@ppe/i18n'

import { en } from './en'
import { lt } from './lt'
import { ru } from './ru'

export type Messages = typeof en

const dictionaries: Record<Lang, Messages> = { en, lt, ru }

/** The text in use. Reassigned by setLanguage; importers see the new value. */
export let t: Messages = en

/** Switches the text, number and date formats, and <html lang>, to lang. */
export function setLanguage(lang: Lang): void {
  applyLanguage(lang)
  t = dictionaries[lang]
}
