import { type Device, deviceOrder } from '../../apps/workwear/src/help/index.ts'
import { en } from '../../apps/workwear/src/i18n/en/index.ts'
import { lt } from '../../apps/workwear/src/i18n/lt/index.ts'
import { ru } from '../../apps/workwear/src/i18n/ru/index.ts'

/** The guide's language, GUIDE_LANG (en, lt or ru): the admin's language and the browser's. */
export const lang = (process.env['GUIDE_LANG'] ?? 'en') as 'en' | 'lt' | 'ru'
if (!['en', 'lt', 'ru'].includes(lang)) throw new Error(`GUIDE_LANG must be en, lt or ru, not ${lang}`)

/** The app's own text in that language, so the steps find controls by the names people see. */
export const T = { en, lt, ru }[lang]

export const locale = { en: 'en-GB', lt: 'lt-LT', ru: 'ru-RU' }[lang]

/** The device the screenshots are for, GUIDE_DEVICE: phone, tablet or desktop, as the Help screen tells them apart. */
export const device = (process.env['GUIDE_DEVICE'] ?? 'desktop') as Device
if (!deviceOrder.includes(device)) throw new Error(`GUIDE_DEVICE must be phone, tablet or desktop, not ${device}`)

/**
 * A window of that device: a phone and a portrait tablet held in the hand
 * (touch, so the app's touch targets), a desktop with a mouse. Each at a
 * pixel ratio that keeps text sharp where Help shows it.
 */
export const deviceWindow = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, isMobile: false, hasTouch: false },
}[device]
