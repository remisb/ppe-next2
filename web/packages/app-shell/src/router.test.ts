import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { type Router, cameFrom, canGoBack, useAddressRouter } from './router.ts'

type R = { name: 'list' } | { name: 'page'; id: string; from?: string }

const addresses = {
  parse: (path: string): R => (path.startsWith('/page/') ? { name: 'page', id: path.slice(6) } : { name: 'list' }),
  pathOf: (r: R) => (r.name === 'page' ? `/page/${r.id}` : '/list'),
  fromOf: (r: R) => (r.name === 'page' ? r.from : undefined),
}

// React's act needs this flag outside a test renderer.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function mount(): { router: () => Router<R>; unmount: () => void } {
  let current: Router<R> | undefined
  const Probe = () => {
    current = useAddressRouter(addresses)
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Probe)))
  return { router: () => current!, unmount: () => act(() => root.unmount()) }
}

afterEach(() => window.history.replaceState(null, '', '/'))

describe('useAddressRouter', () => {
  it('keeps where a link was followed from with its history entry, not in the address', () => {
    window.history.replaceState(null, '', '/list')
    const { router, unmount } = mount()
    expect(cameFrom()).toBeUndefined()
    expect(canGoBack()).toBe(false)
    act(() => router().navigate({ name: 'page', id: '7', from: 'WE-000010' }))
    expect(window.location.pathname).toBe('/page/7')
    expect(canGoBack()).toBe(true)
    expect(cameFrom()).toBe('WE-000010')
    // A link that names no origin keeps none.
    act(() => router().navigate({ name: 'page', id: '8' }))
    expect(cameFrom()).toBeUndefined()
    expect(canGoBack()).toBe(true)
    unmount()
  })

  it('names no origin for an address opened directly', () => {
    window.history.replaceState(null, '', '/page/7')
    const { router, unmount } = mount()
    expect(router().route).toEqual({ name: 'page', id: '7' })
    expect(cameFrom()).toBeUndefined()
    unmount()
  })
})
