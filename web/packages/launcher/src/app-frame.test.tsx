import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NotForYou } from './app-frame.tsx'
import { TileIcon } from './tile-icon.tsx'

// React warns unless it is told this is a test environment for act().
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let unmount = () => {}
afterEach(() => unmount())

function render(node: React.ReactNode): HTMLElement {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  act(() => root.render(node))
  unmount = () => {
    act(() => root.unmount())
    el.remove()
  }
  return el
}

describe('NotForYou', () => {
  it("says so in the app's words, back to the staff app or signing out", () => {
    const onSignOut = vi.fn()
    const el = render(
      <NotForYou text={{ title: 'Not for you', text: 'Ask an administrator.', backToWorkwear: 'Back to Workwear', signOut: 'Sign out' }} onSignOut={onSignOut} />,
    )
    expect(el.querySelector('h1')?.textContent).toBe('Not for you')
    expect(el.textContent).toContain('Ask an administrator.')
    expect(el.querySelector('a')?.textContent).toBe('Back to Workwear')
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/')
    act(() => el.querySelector('button')?.click())
    expect(onSignOut).toHaveBeenCalledOnce()
  })
})

describe('TileIcon', () => {
  it("draws the tile's icon on its colour, hidden from screen readers", () => {
    const el = render(<TileIcon app={{ icon: 'shirt', color: '#123456' }} className="size-8" />)
    const span = el.querySelector('span')
    expect(span?.getAttribute('aria-hidden')).toBe('true')
    expect(span?.style.backgroundColor).toBe('rgb(18, 52, 86)')
    expect(span?.className).toContain('size-8')
    expect(span?.querySelector('svg')).not.toBeNull()
  })
})
