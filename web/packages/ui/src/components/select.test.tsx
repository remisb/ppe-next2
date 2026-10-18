import { Select as SelectPrimitive } from '@base-ui/react/select'
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.tsx'

// React warns unless it is told this is a test environment for act().
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Base UI's <style> that hides the list's scrollbar; React hoists it into <head>. */
function scrollbarStyles() {
  return [...document.querySelectorAll('style')].filter((s) => s.textContent?.includes('base-ui-disable-scrollbar'))
}

let unmount = () => {}

function render(node: ReactNode) {
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  act(() => root.render(node))
  unmount = () => {
    act(() => root.unmount())
    container.remove()
  }
}

afterEach(() => unmount())

describe('Select under the Content-Security-Policy', () => {
  // Ours first: React inserts a hoisted <style href> once per document and
  // never again, even after the element is gone, so the order matters.
  it('ours, open, adds none: styles.css carries the rule', () => {
    render(
      <Select open defaultValue="a">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>,
    )
    expect(document.querySelector('[data-slot="select-content"]')).not.toBeNull()
    expect(scrollbarStyles()).toHaveLength(0)
  })

  it("Base UI's own Select, open, adds an inline <style> (which style-src 'self' refuses)", () => {
    render(
      <SelectPrimitive.Root open defaultValue="a">
        <SelectPrimitive.Trigger />
        <SelectPrimitive.Portal>
          <SelectPrimitive.Positioner>
            <SelectPrimitive.Popup>
              <SelectPrimitive.Item value="a">A</SelectPrimitive.Item>
            </SelectPrimitive.Popup>
          </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>,
    )
    expect(scrollbarStyles()).toHaveLength(1)
  })
})
