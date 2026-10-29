import { describe, expect, it } from 'vitest'

import { addresses } from './router'

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
