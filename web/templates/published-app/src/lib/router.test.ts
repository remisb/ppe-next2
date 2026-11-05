import { describe, expect, it } from 'vitest'

import { type Route, addresses } from './router'

// Every route: add each new screen here.
const routes: Route[] = [{ name: 'home' }]

describe('addresses', () => {
  it('reads and writes each screen', () => {
    for (const r of routes) expect(addresses.parse(addresses.pathOf(r), '')).toEqual(r)
  })
})
