import { describe, expect, it } from 'vitest'

import { KEYBOARD_MIN, keyboardInset } from './keyboard.ts'

describe('keyboardInset', () => {
  it('is nothing while the whole window is visible', () => {
    expect(keyboardInset(844, { height: 844, offsetTop: 0 })).toBe(0)
  })

  it('is the keyboard’s height when it covers the window’s bottom', () => {
    // An iPhone's 844pt window with a 336pt keyboard up.
    expect(keyboardInset(844, { height: 508, offsetTop: 0 })).toBe(336)
  })

  it('is less once the browser has scrolled the page to show the field', () => {
    // Safari scrolled the visual viewport down by 100: 100 less of the window's bottom is hidden.
    expect(keyboardInset(844, { height: 508, offsetTop: 100 })).toBe(236)
  })

  it('ignores the browser’s own bars coming and going', () => {
    expect(keyboardInset(844, { height: 844 - KEYBOARD_MIN, offsetTop: 0 })).toBe(0)
    expect(keyboardInset(844, { height: 844 - 60, offsetTop: 0 })).toBe(0)
  })

  it('rounds to whole pixels', () => {
    expect(keyboardInset(844, { height: 507.6, offsetTop: 0 })).toBe(336)
  })
})
