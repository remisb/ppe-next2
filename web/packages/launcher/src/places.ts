/**
 * Each user's recently opened apps, kept on this device; pins are kept by the
 * API (phase 2). The key follows the origin's `workwear.*` names, shared by
 * every app on it.
 */

/** How many recent apps the launcher remembers. */
export const RECENT_MAX = 6

const key = (userId: string) => `workwear.launcher.${userId}`
const strings = (ids: unknown): string[] => (Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])

interface Stored {
  recent?: unknown
  /** Phase 1's pins, kept on the device; handed to the API once. */
  pinned?: unknown
}

function read(userId: string): Stored {
  try {
    return (JSON.parse(globalThis.localStorage?.getItem(key(userId)) ?? 'null') as Stored | null) ?? {}
  } catch {
    return {}
  }
}

function write(userId: string, s: Stored): void {
  try {
    globalThis.localStorage?.setItem(key(userId), JSON.stringify(s))
  } catch {
    // Private browsing or full storage: the launcher simply forgets.
  }
}

/** The user's recent apps on this device, newest first. */
export const loadRecent = (userId: string): string[] => strings(read(userId).recent).slice(0, RECENT_MAX)

/** Puts an app first among the recent ones, and returns them. */
export function noteOpened(userId: string, slug: string): string[] {
  const s = read(userId)
  const recent = [slug, ...strings(s.recent).filter((x) => x !== slug)].slice(0, RECENT_MAX)
  write(userId, { ...s, recent })
  return recent
}

/** Phase 1's pins on this device, removed as they are read: the launcher hands them to the API once. */
export function takeDevicePins(userId: string): string[] {
  const s = read(userId)
  const pinned = strings(s.pinned)
  if (pinned.length) write(userId, { recent: s.recent })
  return pinned
}

/** The pins with a tile pinned, or unpinned when it was; pins keep the order they were made in. */
export const togglePin = (pins: readonly string[], slug: string): string[] => (pins.includes(slug) ? pins.filter((x) => x !== slug) : [...pins, slug])

/** Whether this device shows a tester the apps in testing (Show apps in testing). */
const previewKey = (userId: string) => `workwear.launcher.preview.${userId}`

export function loadShowTesting(userId: string): boolean {
  try {
    return globalThis.localStorage?.getItem(previewKey(userId)) === '1'
  } catch {
    return false
  }
}

export function saveShowTesting(userId: string, on: boolean): void {
  try {
    globalThis.localStorage?.setItem(previewKey(userId), on ? '1' : '0')
  } catch {
    // As above.
  }
}
