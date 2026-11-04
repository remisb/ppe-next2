import { appById } from './catalogue.ts'

/**
 * Each user's pinned and recently opened apps, kept on this device (phase 1;
 * the registry keeps them per user in phase 2). The key follows the origin's
 * `workwear.*` names, shared by every app on it.
 */
export interface Places {
  pinned: string[]
  recent: string[]
}

/** How many recent apps the launcher remembers. */
export const RECENT_MAX = 6

const key = (userId: string) => `workwear.launcher.${userId}`
const known = (ids: unknown): string[] => (Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && appById(id) !== undefined) : [])

/** What this device keeps for the user; nothing when storage is unavailable or the entry unreadable. */
export function loadPlaces(userId: string): Places {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(key(userId)) ?? 'null') as Partial<Places> | null
    return { pinned: known(raw?.pinned), recent: known(raw?.recent).slice(0, RECENT_MAX) }
  } catch {
    return { pinned: [], recent: [] }
  }
}

export function savePlaces(userId: string, places: Places): void {
  try {
    globalThis.localStorage?.setItem(key(userId), JSON.stringify(places))
  } catch {
    // Private browsing or full storage: the launcher simply forgets.
  }
}

/** Pins an app, or unpins a pinned one; pins keep the order they were made in. */
export const togglePin = (p: Places, id: string): Places => ({
  ...p,
  pinned: p.pinned.includes(id) ? p.pinned.filter((x) => x !== id) : [...p.pinned, id],
})

/** Puts an app first among the recent ones. */
export const noteOpened = (p: Places, id: string): Places => ({ ...p, recent: [id, ...p.recent.filter((x) => x !== id)].slice(0, RECENT_MAX) })
