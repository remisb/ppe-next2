import { afterEach, expect, it } from 'vitest'

import { cleanup, cspNonceMeta, render, settle } from '../test/ui-sdk.ts'
import { Toaster } from './toast.tsx'
import { Drawer } from './drawer.tsx'

afterEach(() => cleanup())

// A file of its own: ui-sdk adds its CSS once per page, so an earlier render would hide the answer.
it("with <meta property=\"csp-nonce\"> and no nonce, ui-sdk adds no <style> (it uses constructed sheets, which no policy blocks)", async () => {
  cspNonceMeta()
  // jsdom has no adoptedStyleSheets; without it ui-sdk falls back to <style>, as an old browser would.
  const adopted: CSSStyleSheet[] = []
  Object.defineProperty(document, 'adoptedStyleSheets', { configurable: true, get: () => adopted, set: (v: CSSStyleSheet[]) => adopted.splice(0, adopted.length, ...v) })
  render(
    <>
      <Drawer open onOpenChange={() => {}} title="Scan">
        <p>Pages</p>
      </Drawer>
      <Toaster />
    </>,
  )
  await settle()
  expect([...document.querySelectorAll('style')].filter((st) => st.textContent?.includes('ui-sdk'))).toEqual([])
  expect(adopted.length).toBeGreaterThan(0)
})
