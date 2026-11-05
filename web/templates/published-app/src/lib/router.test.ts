import { describe, expect, it } from 'vitest'

import manifest from '../../public/ppe-app.json'
import { type Route, addresses } from './router'

// Every route: add each new screen here, and its first path segment to
// public/ppe-app.json's screens.
const routes: Route[] = [{ name: 'home' }]

describe('addresses', () => {
  it('reads and writes each screen', () => {
    for (const r of routes) expect(addresses.parse(addresses.pathOf(r), '')).toEqual(r)
  })
})

describe('the manifest', () => {
  // The API refuses a variant named like a screen (/apps/<slug>/<name>/ opens a channel first).
  it("lists the router's first-level screens", () => {
    const firsts = [...new Set(routes.map((r) => addresses.pathOf(r).split('/')[1]).filter((s): s is string => !!s))].sort()
    expect([...manifest.screens].sort()).toEqual(firsts)
  })
})
