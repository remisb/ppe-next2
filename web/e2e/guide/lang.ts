import { en } from '../../apps/workwear/src/i18n/en/index.ts'
import { lt } from '../../apps/workwear/src/i18n/lt/index.ts'
import { ru } from '../../apps/workwear/src/i18n/ru/index.ts'

/** The guide's language, GUIDE_LANG (en, lt or ru): the admin's language and the browser's. */
export const lang = (process.env['GUIDE_LANG'] ?? 'en') as 'en' | 'lt' | 'ru'
if (!['en', 'lt', 'ru'].includes(lang)) throw new Error(`GUIDE_LANG must be en, lt or ru, not ${lang}`)

/** The app's own text in that language, so the steps find controls by the names people see. */
export const T = { en, lt, ru }[lang]

export const locale = { en: 'en-GB', lt: 'lt-LT', ru: 'ru-RU' }[lang]
