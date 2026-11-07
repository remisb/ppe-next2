import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { manifestHref } from '@ppe/app-shell'
import type { Lang } from '@ppe/i18n'
import { afterAll, describe, expect, it } from 'vitest'

import { setLanguage, t } from '@/i18n'
import { parsePath } from '@/lib/router'

// The home-screen app's manifest, one per language (web/AGENTS.md, "Home-screen app"):
// ApiProvider points the page at the user's, so the app installed is named in it.
interface Manifest {
  id: string
  name: string
  lang: string
  start_url: string
  scope: string
  display: string
  icons: unknown[]
  shortcuts: { name: string; url: string }[]
  [key: string]: unknown
}
// A variable, not a template in new URL(): Vite would take that for its own asset import.
const file = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const read = (lang: Lang) => JSON.parse(file('../public' + manifestHref(lang))) as Manifest
const langs: Lang[] = ['en', 'lt', 'ru']

afterAll(() => setLanguage('en'))

describe('the manifest', () => {
  it('is one app, the same in every language but its words', () => {
    const en = read('en')
    expect(en).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' })
    for (const lang of langs) {
      const m = read(lang)
      expect(m.lang).toBe(lang)
      const { name: _n, description: _d, lang: _l, shortcuts, ...rest } = m
      const { name: _en, description: _ed, lang: _el, shortcuts: enShortcuts, ...enRest } = en
      expect(rest, lang).toEqual(enRest)
      expect(shortcuts.map((s) => s.url), lang).toEqual(enShortcuts.map((s) => s.url))
    }
  })

  it("names the app and its icon's shortcuts as the app does, in each language", () => {
    for (const lang of langs) {
      setLanguage(lang)
      const m = read(lang)
      expect(m.name, lang).toBe(t.common.appName)
      expect(m.shortcuts.map((s) => s.name), lang).toEqual([t.shell.newOrderButton, t.shell.history, t.shell.employees, t.shell.groups.apps])
    }
  })

  it("opens each shortcut on a screen of the staff app, or App Launcher", () => {
    const urls = read('en').shortcuts.map((s) => s.url)
    expect(urls.map((u) => (u.startsWith('/apps/') ? 'launcher' : parsePath(u).name))).toEqual(['createOrder', 'history', 'employees', 'launcher'])
  })
})
