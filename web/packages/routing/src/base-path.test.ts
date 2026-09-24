import { describe, expect, it } from 'vitest'

import { stripBase } from './base-path.ts'

describe('stripBase', () => {
  it('passes paths through with no base', () => {
    expect(stripBase('/employees', '')).toBe('/employees')
  })
  it('strips the prefix', () => {
    expect(stripBase('/app/employees', '/app')).toBe('/employees')
  })
  it('maps the bare prefix to the root', () => {
    expect(stripBase('/app', '/app')).toBe('/')
  })
  it('does not treat a longer sibling as the prefix', () => {
    expect(stripBase('/application', '/app')).toBe('/application')
  })
  it('leaves an unprefixed path unchanged', () => {
    expect(stripBase('/other', '/app')).toBe('/other')
  })
})
