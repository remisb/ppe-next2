import { describe, expect, it } from 'vitest'

import { adminBase, adminHref, staffHref } from './apps.ts'
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

describe('app addresses', () => {
  it('links into the staff app at the root and Administration under /admin', () => {
    expect(staffHref('/orders')).toBe('/orders')
    expect(adminHref('/')).toBe('/admin/')
    expect(adminHref('/users')).toBe('/admin/users')
    expect(stripBase(adminHref('/users'), adminBase)).toBe('/users')
  })
})
