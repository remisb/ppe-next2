import { describe, expect, it } from 'vitest'

import { MAX_EMAIL_LENGTH, isEmail } from './email'

describe('isEmail', () => {
  it('takes one bare address with a dot in its domain, as the API does', () => {
    for (const ok of ['name@example.com', 'sim@telia.lt', 'first.last+tag@mail.co.uk']) expect(isEmail(ok)).toBe(true)
    for (const bad of ['', 'name', 'name@localhost', 'Name <name@example.com>', 'a@example.com, b@example.lt', 'a b@example.lt', ' name@example.com', 'a,b@example.lt'])
      expect(isEmail(bad)).toBe(false)
  })

  it('refuses one longer than the limit', () => {
    const at = '@example.com'
    expect(isEmail('a'.repeat(MAX_EMAIL_LENGTH - at.length) + at)).toBe(true)
    expect(isEmail('a'.repeat(MAX_EMAIL_LENGTH - at.length + 1) + at)).toBe(false)
  })
})
