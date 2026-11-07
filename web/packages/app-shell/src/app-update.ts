/**
 * Telling an app that stays open that a newer build is deployed. Added to a
 * phone's home screen, an app runs without the browser's bars, so nobody
 * reloads it, and the phone keeps it in memory for days: it would go on
 * running the build it opened with. A build's index.html names its entry
 * script by its hash (Vite's /…/assets/index-<hash>.js), and Caddy serves
 * index.html no-cache, so fetching it again tells whether a deploy changed it.
 */

/** The hashed entry script a built index.html runs, or null (Vite's dev server, which loads /src/main.tsx). */
export function entryOf(doc: Pick<Document, 'querySelector'>): string | null {
  const src = doc.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null
  return src && src.includes('/assets/') ? src : null
}

/** Where the app's index.html is: its entry's address up to /assets/ (/, /admin/, /apps/). */
export function pageOf(entry: string, base: string): string {
  const url = new URL(entry, base).href
  return url.slice(0, url.lastIndexOf('/assets/') + 1)
}

/** The entry the deployed index.html names now, or null when it cannot be read (offline, an error). */
export async function deployedEntry(page: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetcher(page, { cache: 'no-cache', credentials: 'same-origin' })
    if (!res.ok) return null
    return entryOf(new DOMParser().parseFromString(await res.text(), 'text/html'))
  } catch {
    return null
  }
}

/** How often an open, shown app checks; and the least time between two checks. */
export const CHECK_EVERY_MS = 30 * 60_000
export const CHECK_AT_MOST_EVERY_MS = 60_000

/**
 * Calls onNewer once, when the deployed build is not the one this page runs:
 * checked every 30 minutes while the app is shown, and each time it is shown
 * again (a phone's app brought back), at most once a minute. Returns the
 * function that stops it. Under Vite's dev server it never checks.
 */
export function watchForNewBuild(onNewer: () => void, fetcher: typeof fetch = fetch): () => void {
  const running = entryOf(document)
  if (!running) return () => {}
  const page = pageOf(running, window.location.href)
  let last = 0
  let done = false
  const check = async () => {
    if (done || document.visibilityState !== 'visible' || Date.now() - last < CHECK_AT_MOST_EVERY_MS) return
    last = Date.now()
    const deployed = await deployedEntry(page, fetcher)
    if (done || !deployed || new URL(deployed, page).href === new URL(running, page).href) return
    done = true
    stop()
    onNewer()
  }
  const onVisible = () => void check()
  const timer = window.setInterval(onVisible, CHECK_EVERY_MS)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onVisible)
  const stop = () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onVisible)
  }
  return () => {
    done = true
    stop()
  }
}

const RELOADED_KEY = 'ppe.reloadedForBuild'
/** A reload within this long of the last one is not tried again: the file is missing for another reason. */
export const RELOAD_GUARD_MS = 20_000

/**
 * A screen's code that loads on first use (Help, the date picker's calendar)
 * is a file of the build the page opened with; a deploy removes it, and Vite
 * then fires vite:preloadError. The page reloads once onto the new build
 * instead of failing; a second failure soon after is left to show as an error.
 */
export function reloadWhenFilesAreGone(reload: () => void = () => window.location.reload()): () => void {
  const onPreloadError = (e: Event) => {
    let lastReload = 0
    try {
      lastReload = Number(window.sessionStorage.getItem(RELOADED_KEY) ?? 0)
    } catch {
      // Storage refused: reload anyway, once per page.
    }
    if (Date.now() - lastReload < RELOAD_GUARD_MS) return
    try {
      window.sessionStorage.setItem(RELOADED_KEY, String(Date.now()))
    } catch {
      // As above.
    }
    e.preventDefault()
    reload()
  }
  window.addEventListener('vite:preloadError', onPreloadError)
  return () => window.removeEventListener('vite:preloadError', onPreloadError)
}
