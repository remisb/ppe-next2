import type { SignedInDevice } from '@ppe/api-client'

/** This device first, then the rest as the server sent them (last used first). */
export function sortDevices(devices: readonly SignedInDevice[]): SignedInDevice[] {
  return [...devices].sort((a, b) => Number(b.current) - Number(a.current))
}
