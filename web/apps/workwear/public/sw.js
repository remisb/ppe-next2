// The offline screen's service worker, registered by @ppe/app-shell's registerOfflineScreen
// (web/AGENTS.md, "Home-screen app"). It keeps only the offline screen: every page and file
// still comes from the server, and only when a page cannot be loaded at all (no network, the
// server down) does offline.html stand in for it. Nothing else is cached, so the apps' own
// caching (hashed files, index.html no-cache) and the new-version notice work as before.
//
// The cache is named after the offline files' hash (src/offline.test.ts checks it), so a change
// to them changes this file, and browsers install it again with the new files.
const CACHE = 'ppe-offline-aab8f25b3c36'
const OFFLINE = '/offline.html'
const FILES = [OFFLINE, '/offline.css', '/offline.js', '/favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))
      // Chrome's static routing: anything but a page load or the offline screen's own files goes
      // straight to the network, without starting this worker. Elsewhere the fetch handler below
      // lets those through untouched.
      try {
        await event.addRoutes?.([
          { condition: { or: FILES.filter((f) => f !== OFFLINE).map((pathname) => ({ urlPattern: { pathname } })) }, source: 'fetch-event' },
          { condition: { not: { requestMode: 'navigate' } }, source: 'network' },
        ])
      } catch {
        // Not supported: the fetch handler decides.
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('ppe-offline-') && key !== CACHE) await caches.delete(key)
      // The page load starts while this worker wakes up, so it costs no time.
      await self.registration.navigationPreload?.enable()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  // The offline screen's files: from the server while it answers (Caddy sends them no-cache, so the
  // browser's own cache cannot stand in), else from this worker's cache.
  const url = new URL(request.url)
  if (request.mode !== 'navigate' && url.origin === self.location.origin && FILES.includes(url.pathname)) {
    event.respondWith(fetch(request).catch(async () => (await caches.match(url.pathname)) ?? Response.error()))
    return
  }
  if (request.mode !== 'navigate') return
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse
        if (preloaded) return preloaded
        return await fetch(request)
      } catch {
        return (await caches.match(OFFLINE)) ?? Response.error()
      }
    })(),
  )
})
