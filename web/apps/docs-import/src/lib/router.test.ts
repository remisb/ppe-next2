import { describe, expect, it } from 'vitest'

import { type Route, addresses } from './router'

// Every route: add each new screen here.
const routes: Route[] = [{ name: 'home' }, { name: 'scan' }]

describe('addresses', () => {
  it('reads and writes each screen', () => {
    for (const r of routes) expect(addresses.parse(addresses.pathOf(r), '')).toEqual(r)
  })

  it('opens Scan Document with a trailing slash too, and anything else as Import', () => {
    expect(addresses.parse('/scan/', '')).toEqual({ name: 'scan' })
    expect(addresses.parse('/elsewhere', '')).toEqual({ name: 'home' })
  })
})
