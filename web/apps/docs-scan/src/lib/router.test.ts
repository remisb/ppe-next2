import { describe, expect, it } from 'vitest'

import { type Route, addresses } from './router'

const id = '0b1c2d3e-4f50-4617-8899-aabbccddeeff'
const employee = '11111111-2222-4333-8444-555555555555'

// Every route: add each new screen here.
const routes: Route[] = [
  { name: 'home' },
  { name: 'camera' },
  { name: 'scan', id },
  { name: 'find', id },
  { name: 'update', id, employee },
  { name: 'merge', id },
  { name: 'new', id },
  { name: 'saved', id },
  { name: 'adjust', id, page: 2 },
]

describe('addresses', () => {
  it('reads and writes each screen', () => {
    for (const r of routes) expect(addresses.parse(addresses.pathOf(r), '')).toEqual(r)
  })
  it('takes anything else to Scans, or a scan’s own screen', () => {
    expect(addresses.parse('/scan/not-an-id', '')).toEqual({ name: 'home' })
    expect(addresses.parse(`/scan/${id}/update/x`, '')).toEqual({ name: 'scan', id })
    expect(addresses.parse(`/scan/${id}/adjust/0`, '')).toEqual({ name: 'scan', id })
    expect(addresses.parse('/somewhere', '')).toEqual({ name: 'home' })
  })
})
