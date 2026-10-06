import { useSyncExternalStore } from 'react'

/**
 * Light, dark or the device's own setting (system). Saved on this device, not
 * the account: it is about the screen and the room, and it holds before
 * anyone signs in. It acts through <html data-theme> (index.css), which
 * index.html sets from storage before the first paint.
 */
export type Theme = 'light' | 'dark' | 'system'

export const themes: readonly Theme[] = ['light', 'dark', 'system']

/** Also read by the inline script in index.html; keep the two in step. */
const KEY = 'workwear.theme'

export function loadTheme(storage: Storage | undefined = globalThis.localStorage): Theme {
  try {
    const t = storage?.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

export function saveTheme(t: Theme, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    if (t === 'system') storage?.removeItem(KEY)
    else storage?.setItem(KEY, t)
  } catch {
    // Storage unavailable: the choice holds until the page is reloaded.
  }
}

// The browser's own bars follow the page: index.html's theme-color metas, one per scheme.
const barColour = { light: '#ffffff', dark: '#0a0a0a' }

const listeners = new Set<() => void>()

/** Sets the theme in use and tells every switch. */
export function applyTheme(t: Theme): void {
  const root = globalThis.document?.documentElement
  if (!root) return
  if (t === 'system') delete root.dataset['theme']
  else root.dataset['theme'] = t
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = barColour[t === 'system' ? ((meta.getAttribute('media') ?? '').includes('dark') ? 'dark' : 'light') : t]
  }
  for (const l of listeners) l()
}

function current(): Theme {
  const t = globalThis.document?.documentElement.dataset['theme']
  return t === 'light' || t === 'dark' ? t : 'system'
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The theme in use and a setter that saves it on this device. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const t = useSyncExternalStore(subscribe, current)
  return [
    t,
    (next: Theme) => {
      saveTheme(next)
      applyTheme(next)
    },
  ]
}
