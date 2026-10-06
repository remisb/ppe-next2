import { type Device, deviceOrder } from '../../apps/workwear/src/help/index.ts'
import { en } from '../../apps/workwear/src/i18n/en/index.ts'
import { lt } from '../../apps/workwear/src/i18n/lt/index.ts'
import { ru } from '../../apps/workwear/src/i18n/ru/index.ts'
import { en as adminEn } from '../../apps/admin/src/i18n/en/index.ts'
import { lt as adminLt } from '../../apps/admin/src/i18n/lt/index.ts'
import { ru as adminRu } from '../../apps/admin/src/i18n/ru/index.ts'
import { dictionaries as shellText } from '../../packages/app-shell/src/text.ts'

/** The guide's language, GUIDE_LANG (en, lt or ru): the admin's language and the browser's. */
export const lang = (process.env['GUIDE_LANG'] ?? 'en') as 'en' | 'lt' | 'ru'
if (!['en', 'lt', 'ru'].includes(lang)) throw new Error(`GUIDE_LANG must be en, lt or ru, not ${lang}`)

/** The app's own text in that language, so the steps find controls by the names people see. */
export const T = { en, lt, ru }[lang]

/** Administration's text in that language. */
export const A = { en: adminEn, lt: adminLt, ru: adminRu }[lang]

/** The sign-in screen's text in that language (@ppe/app-shell's). */
export const S = shellText[lang]

export const locale = { en: 'en-GB', lt: 'lt-LT', ru: 'ru-RU' }[lang]

/** The device the screenshots are for, GUIDE_DEVICE: phone, tablet or desktop, as the Help screen tells them apart. */
export const device = (process.env['GUIDE_DEVICE'] ?? 'desktop') as Device
if (!deviceOrder.includes(device)) throw new Error(`GUIDE_DEVICE must be phone, tablet or desktop, not ${device}`)

/** What each device's browser calls itself, so Signed-in devices names it as people would see it. */
export const agents = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
}

/**
 * A window of that device: a phone and a portrait tablet held in the hand
 * (touch, so the app's touch targets), a desktop with a mouse. Each at a
 * pixel ratio that keeps text sharp where Help shows it.
 */
export const deviceWindow = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: agents.iphone },
  tablet: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true, userAgent: agents.ipad },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, isMobile: false, hasTouch: false, userAgent: agents.windows },
}[device]
