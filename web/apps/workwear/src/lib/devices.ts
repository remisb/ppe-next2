import type { SignedInDevice } from '@ppe/api-client'

import { t } from '@/i18n'

export interface DeviceName {
  browser: string | null
  system: string | null
}

/**
 * The browser and operating system a sign-in was last used from, read from
 * its User-Agent well enough to recognise one's own devices; null where the
 * string says nothing known. Order matters: Edge and Opera also say Chrome,
 * Chrome also says Safari, and an iPad may say Macintosh.
 */
export function deviceName(userAgent: string): DeviceName {
  const ua = userAgent
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser\//.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua) && /Version\//.test(ua)
              ? 'Safari'
              : null
  const system = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Macintosh|Mac OS X/.test(ua)
              ? 'Mac'
              : /Linux/.test(ua)
                ? 'Linux'
                : null
  return { browser, system }
}

/** "Chrome on Windows", in the language in use; "Unknown browser" when nothing is known. */
export function deviceLabel(userAgent: string): string {
  const { browser, system } = deviceName(userAgent)
  if (browser && system) return t.account.deviceOn(browser, system)
  return browser ?? system ?? t.account.unknownDevice
}

/** This device first, then the rest as the server sent them (last used first). */
export function sortDevices(devices: readonly SignedInDevice[]): SignedInDevice[] {
  return [...devices].sort((a, b) => Number(b.current) - Number(a.current))
}
