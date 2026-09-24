import { describe, expect, it } from 'vitest'

import { validatePasswordChange } from './password'

describe('validatePasswordChange', () => {
  const ok = { current: 'change-me-please', next: 'a-better-password', confirm: 'a-better-password' }

  it('accepts a valid change', () => {
    expect(validatePasswordChange(ok)).toEqual({})
  })
  it('requires the current password', () => {
    expect(validatePasswordChange({ ...ok, current: '' }).current).toBeDefined()
  })
  it('enforces 8 characters and 72 bytes', () => {
    expect(validatePasswordChange({ ...ok, next: 'short', confirm: 'short' }).next).toMatch(/at least 8/)
    const long = 'x'.repeat(73)
    expect(validatePasswordChange({ ...ok, next: long, confirm: long }).next).toMatch(/too long/)
    // The limit is bytes: 36 Cyrillic letters are 72 bytes (allowed), 37 are 74.
    const at72 = 'ж'.repeat(36)
    expect(validatePasswordChange({ ...ok, next: at72, confirm: at72 })).toEqual({})
    const over = 'ж'.repeat(37)
    expect(validatePasswordChange({ ...ok, next: over, confirm: over }).next).toMatch(/too long/)
  })
  it('rejects reusing the current password', () => {
    expect(validatePasswordChange({ ...ok, next: ok.current, confirm: ok.current }).next).toMatch(/different/)
  })
  it('requires a matching confirmation', () => {
    expect(validatePasswordChange({ ...ok, confirm: 'something-else' }).confirm).toMatch(/do not match/)
  })
})
