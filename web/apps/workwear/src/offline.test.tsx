import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Offline } from '@ppe/app-shell'
import type { Lang } from '@ppe/i18n'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { setLanguage } from '@/i18n'

// The offline screen (public/offline.html, offline.js, offline.css), which the service worker
// public/sw.js shows when a page cannot be loaded at all (web/AGENTS.md, "Home-screen app").
// A variable, not a template in new URL(): Vite would take that for its own asset import.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const publicFile = (name: string) => read('../public/' + name)
const offlineFiles = ['offline.html', 'offline.css', 'offline.js', 'favicon.svg']

/** offline.html as the service worker serves it, its script run, with the device's language and theme. */
function showOffline(lang: string | null, theme?: string) {
  window.localStorage.clear()
  if (lang) window.localStorage.setItem('workwear.language', lang)
  if (theme) window.localStorage.setItem('workwear.theme', theme)
  const body = /<body>([\s\S]*)<\/body>/.exec(publicFile('offline.html'))?.[1] ?? ''
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '')
  new Function(publicFile('offline.js'))()
  return [...document.querySelectorAll('[data-word]')].map((e) => e.textContent)
}

afterEach(() => {
  window.localStorage.clear()
  document.body.innerHTML = ''
  delete document.documentElement.dataset['theme']
})
afterAll(() => setLanguage('en'))

describe('the offline screen', () => {
  it("says what the app's own Offline gate says, with its Retry, in each language", () => {
    for (const lang of ['en', 'lt', 'ru'] as Lang[]) {
      setLanguage(lang)
      const gate = document.createElement('div')
      gate.innerHTML = renderToStaticMarkup(<Offline onRetry={() => {}} />)
      const [title, hint, retry] = showOffline(lang)
      expect(document.documentElement.lang).toBe(lang)
      for (const words of [title, hint, retry]) expect(gate.textContent, lang).toContain(words)
    }
  })

  it("follows the device's theme, and speaks English for a language the app does not", () => {
    showOffline('en', 'dark')
    expect(document.documentElement.dataset['theme']).toBe('dark')
    const english = showOffline('en')
    // jsdom's browser language is English.
    expect(showOffline('xx')).toEqual(english)
    expect(document.documentElement.lang).toBe('en')
  })

  it('is cached under a name that changes with its files, so browsers take the new ones', () => {
    const hash = createHash('sha256')
      .update(offlineFiles.map(publicFile).join(''))
      .digest('hex')
      .slice(0, 12)
    const sw = publicFile('sw.js')
    expect(sw).toContain(`const CACHE = 'ppe-offline-${hash}'`)
    for (const f of offlineFiles) expect(sw).toContain(`'/${f}'`.replace("'/offline.html'", 'OFFLINE'))
    expect(sw).toContain("const OFFLINE = '/offline.html'")
  })
})
