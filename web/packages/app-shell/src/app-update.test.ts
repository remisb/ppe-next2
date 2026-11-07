import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHECK_EVERY_MS, RELOAD_GUARD_MS, deployedEntry, entryOf, pageOf, reloadWhenFilesAreGone, watchForNewBuild } from './app-update.ts'

const page = (entry: string) => `<!doctype html><html><head><script type="module" crossorigin src="${entry}"></script></head><body></body></html>`
const answer = (html: string) => vi.fn(async () => new Response(html, { status: 200 })) as unknown as typeof fetch
const flush = () => new Promise((r) => setTimeout(r, 0))

function runBuild(entry: string | null) {
  document.head.innerHTML = entry ? `<script type="module" src="${entry}"></script>` : '<script type="module" src="/src/main.tsx"></script>'
}

afterEach(() => {
  vi.useRealTimers()
  document.head.innerHTML = ''
  window.sessionStorage.clear()
})

describe('the running build', () => {
  it("is the built index.html's hashed entry, and none under Vite's dev server", () => {
    runBuild('/admin/assets/index-abc123.js')
    expect(entryOf(document)).toBe('/admin/assets/index-abc123.js')
    runBuild(null)
    expect(entryOf(document)).toBeNull()
  })

  it("is read from the app's own index.html: /, /admin/ or /apps/", () => {
    expect(pageOf('/assets/index-a.js', 'https://w.test/orders/1')).toBe('https://w.test/')
    expect(pageOf('/admin/assets/index-a.js', 'https://w.test/admin/users')).toBe('https://w.test/admin/')
    expect(pageOf('/apps/assets/index-a.js', 'https://w.test/apps/')).toBe('https://w.test/apps/')
  })

  it('is unknown when the page cannot be fetched', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await deployedEntry('/', offline)).toBeNull()
    const down = vi.fn(async () => new Response('', { status: 502 })) as unknown as typeof fetch
    expect(await deployedEntry('/', down)).toBeNull()
    expect(await deployedEntry('/', answer(page('/assets/index-b.js')))).toBe('/assets/index-b.js')
  })
})

describe('a newer build', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }))

  it('is told once, when the deployed index.html names another entry', async () => {
    runBuild('/assets/index-old.js')
    const onNewer = vi.fn()
    const same = answer(page('/assets/index-old.js'))
    const stop = watchForNewBuild(onNewer, same)
    vi.advanceTimersByTime(CHECK_EVERY_MS)
    await flush()
    expect(same).toHaveBeenCalledWith('http://localhost:3000/', expect.objectContaining({ cache: 'no-cache' }))
    expect(onNewer).not.toHaveBeenCalled()
    stop()

    const newer = answer(page('/assets/index-new.js'))
    watchForNewBuild(onNewer, newer)
    vi.advanceTimersByTime(CHECK_EVERY_MS)
    await flush()
    expect(onNewer).toHaveBeenCalledTimes(1)
    // It stops checking once told.
    vi.advanceTimersByTime(CHECK_EVERY_MS * 3)
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(newer).toHaveBeenCalledTimes(1)
  })

  it('is checked when the app is shown again, at most once a minute', async () => {
    runBuild('/assets/index-old.js')
    const same = answer(page('/assets/index-old.js'))
    const stop = watchForNewBuild(() => {}, same)
    document.dispatchEvent(new Event('visibilitychange'))
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(same).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(61_000)
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(same).toHaveBeenCalledTimes(2)
    stop()
  })

  it("is never looked for under Vite's dev server", async () => {
    runBuild(null)
    const f = answer(page('/assets/index-new.js'))
    const onNewer = vi.fn()
    watchForNewBuild(onNewer, f)
    vi.advanceTimersByTime(CHECK_EVERY_MS)
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(f).not.toHaveBeenCalled()
    expect(onNewer).not.toHaveBeenCalled()
  })
})

describe('a file of the old build that is gone', () => {
  it('reloads the page once, and not again soon after', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const reload = vi.fn()
    const stop = reloadWhenFilesAreGone(reload)
    const failed = () => {
      const e = new Event('vite:preloadError', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    }
    expect(failed()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    // The reloaded page fails again at once: the error is left to show.
    expect(failed()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(RELOAD_GUARD_MS + 1)
    expect(failed()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
    stop()
  })
})
