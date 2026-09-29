import { useCallback, useSyncExternalStore } from 'react'

/**
 * Table density for people who use the app all day with a mouse: Compact
 * rows are 32px instead of 36–37px. It is saved per user on this device, like
 * the draft order, but outlives Sign out: it is a preference, not work. It
 * acts only through the `compact:` variant (index.css), which needs a fine
 * pointer, so touch screens keep their 44px targets whatever is saved.
 */
export type Density = 'comfortable' | 'compact'

const PREFIX = 'workwear.density.'

export function loadDensity(userId: string, storage: Storage | undefined = globalThis.localStorage): Density {
  try {
    return storage?.getItem(PREFIX + userId) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

export function saveDensity(userId: string, d: Density, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    if (d === 'compact') storage?.setItem(PREFIX + userId, d)
    else storage?.removeItem(PREFIX + userId)
  } catch {
    // Storage unavailable: the choice holds until the page is reloaded.
  }
}

// The density in use, on <html data-density>: the `compact:` variant reads it,
// and every switch (Account, the palette) follows it through this store.
const listeners = new Set<() => void>()

/** Sets the density in use (null when no one is signed in) and tells every switch. */
export function applyDensity(d: Density | null): void {
  const root = globalThis.document?.documentElement
  if (!root) return
  if (d === 'compact') root.dataset['density'] = d
  else delete root.dataset['density']
  for (const l of listeners) l()
}

function current(): Density {
  return globalThis.document?.documentElement.dataset['density'] === 'compact' ? 'compact' : 'comfortable'
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The density in use and a setter that saves it for the user. */
export function useDensity(userId: string): [Density, (d: Density) => void] {
  const d = useSyncExternalStore(subscribe, current)
  const set = useCallback(
    (next: Density) => {
      saveDensity(userId, next)
      applyDensity(next)
    },
    [userId],
  )
  return [d, set]
}
