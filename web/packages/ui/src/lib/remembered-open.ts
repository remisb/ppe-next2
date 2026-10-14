import { useCallback, useState } from 'react'

/**
 * Whether a section is open, remembered on this device under key (the app
 * puts the user's id in it, so it is per user). Like density it outlives
 * Sign out: it is a preference, not work. Without storage, or with nothing
 * saved, a section is as it starts: fallback.
 */
export function loadOpen(key: string, fallback: boolean, storage: Storage | undefined = globalThis.localStorage): boolean {
  try {
    const saved = storage?.getItem(key)
    return saved === 'open' ? true : saved === 'closed' ? false : fallback
  } catch {
    return fallback
  }
}

export function saveOpen(key: string, open: boolean, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(key, open ? 'open' : 'closed')
  } catch {
    // Storage unavailable: the section stays as chosen until the page is left.
  }
}

/** Open or closed, read once from storage when key is given, and saved on every change. */
export function useRememberedOpen(key: string | undefined, fallback: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => (key ? loadOpen(key, fallback) : fallback))
  const set = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (key) saveOpen(key, next)
    },
    [key],
  )
  return [open, set]
}
