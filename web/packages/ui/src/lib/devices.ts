/** What a sign-in's User-Agent says about the device, for the lists that show sign-ins. */
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
