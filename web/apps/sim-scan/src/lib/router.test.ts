import { describe, expect, it } from 'vitest'

import manifest from '../../public/ppe-app.json'
import { type Route, addresses } from './router'

// Every route, so the manifest's screens can be checked against them.
const routes: Route[] = [{ name: 'scan' }, { name: 'find' }]

describe('addresses', () => {
  it('reads and writes each screen', () => {
    expect(addresses.parse('/', '')).toEqual({ name: 'scan' })
    expect(addresses.parse('/find', '')).toEqual({ name: 'find' })
    expect(addresses.parse('/find/', '')).toEqual({ name: 'find' })
    expect(addresses.parse('/elsewhere', '')).toEqual({ name: 'scan' })
    expect(addresses.pathOf({ name: 'find' })).toBe('/find')
    expect(addresses.pathOf({ name: 'scan' })).toBe('/')
  })
})

describe('the manifest', () => {
  // The API refuses a variant named like a screen (/apps/sim-scan/<name>/ opens a channel first).
  it("lists the router's first-level screens", () => {
    const firsts = [...new Set(routes.map((r) => addresses.pathOf(r).split('/')[1]).filter((s): s is string => !!s))].sort()
    expect([...manifest.screens].sort()).toEqual(firsts)
  })
})
