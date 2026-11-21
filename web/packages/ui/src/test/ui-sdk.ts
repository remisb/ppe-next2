import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

/*
 * What jsdom lacks for ui-sdk's components (the ui-sdk skill's testing reference), and a
 * render like the package's other component tests. Imported by the ui-sdk wrappers' tests
 * alone: the stubs would change what other tests measure.
 */
declare global {
  var __UI_SDK_STRICT__: boolean | undefined
}
globalThis.__UI_SDK_STRICT__ = true
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

HTMLElement.prototype.showPopover = function () {}
HTMLElement.prototype.hidePopover = function () {}
Element.prototype.getAnimations = () => []
Element.prototype.scrollIntoView = function () {}
Element.prototype.checkVisibility = () => true
Element.prototype.getClientRects = () => [] as unknown as DOMRectList
document.elementFromPoint = () => null
document.elementsFromPoint = () => []
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
document.head.append(Object.assign(document.createElement('style'), { textContent: '[popover] { display: block !important }' }))

/** The tag every app's index.html carries so ui-sdk's CSS goes in as constructed sheets. */
export function cspNonceMeta() {
  const meta = document.createElement('meta')
  meta.setAttribute('property', 'csp-nonce')
  document.head.prepend(meta)
  return meta
}

let unmounts: (() => void)[] = []

export function render(node: ReactNode) {
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  act(() => root.render(node))
  unmounts.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return container
}

export function cleanup() {
  unmounts.forEach((u) => u())
  unmounts = []
}

/** Lets ui-sdk's delayed work (focus, announcements, closing) finish inside act(). */
export async function settle(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

export function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent)?.trim() === name)
  if (!found) throw new Error(`no button named ${name}`)
  return found
}
