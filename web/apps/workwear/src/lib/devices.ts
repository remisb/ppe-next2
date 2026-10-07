import type { SignedInDevice } from '@ppe/api-client'

import { deviceName } from '@ppe/ui/lib/devices'

import { t } from '@/i18n'

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
