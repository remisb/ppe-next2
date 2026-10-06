import { describe, expect, it } from 'vitest'

import { applyDensity, loadDensity, saveDensity } from './density.ts'

describe('density', () => {
  it('is comfortable until a user picks compact, and is kept per user', () => {
    const storage = window.localStorage
    storage.clear()
    expect(loadDensity('u1', storage)).toBe('comfortable')
    saveDensity('u1', 'compact', storage)
    expect(loadDensity('u1', storage)).toBe('compact')
    expect(loadDensity('u2', storage)).toBe('comfortable')
    saveDensity('u1', 'comfortable', storage)
    expect(storage.length).toBe(0)
  })

  it('ignores a value it does not know', () => {
    window.localStorage.setItem('workwear.density.u1', 'cosy')
    expect(loadDensity('u1')).toBe('comfortable')
  })

  it('marks the page for the compact: variant, and clears it on sign out', () => {
    applyDensity('compact')
    expect(document.documentElement.dataset['density']).toBe('compact')
    applyDensity(null)
    expect(document.documentElement.dataset['density']).toBeUndefined()
  })
})
