import { describe, expect, it } from 'vitest'

import { isTyping, stepTo } from './list-keys.ts'

describe('stepTo', () => {
  it('steps through the list as shown and stops at its ends', () => {
    const ids = ['a', 'b', 'c']
    expect([stepTo(ids, 'b', 'j'), stepTo(ids, 'b', 'k')]).toEqual(['c', 'a'])
    expect([stepTo(ids, 'c', 'j'), stepTo(ids, 'a', 'k')]).toEqual([undefined, undefined])
    expect(stepTo(ids, 'x', 'j')).toBeUndefined()
  })
})

describe('isTyping', () => {
  it('is a field or editable content, not the page', () => {
    expect(isTyping(document.createElement('input'))).toBe(true)
    expect(isTyping(document.createElement('button'))).toBe(false)
    expect(isTyping(null)).toBe(false)
  })
})
