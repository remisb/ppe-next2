import { describe, expect, it } from 'vitest'

import { MAX_PROVIDERS, providerProblem, sameProviders, withProvider, withoutProvider } from './sim-providers'

describe('providerProblem', () => {
  it('takes a new name, trimmed', () => {
    expect(providerProblem(['Telia'], ' Bitė ')).toBeUndefined()
  })

  it('refuses an empty name, one listed in any case, a long one and one too many', () => {
    expect(providerProblem([], '  ')).toBe('empty')
    expect(providerProblem(['Telia'], ' telia')).toBe('duplicate')
    expect(providerProblem([], 'a'.repeat(101))).toBe('tooLong')
    expect(providerProblem(Array.from({ length: MAX_PROVIDERS }, (_, i) => `P${i}`), 'Bitė')).toBe('tooMany')
  })
})

describe('withProvider and withoutProvider', () => {
  it('makes the first provider the default, and keeps the default after that', () => {
    const first = withProvider({ providers: [], default: '' }, ' Telia ')
    expect(first).toEqual({ providers: ['Telia'], default: 'Telia' })
    expect(withProvider(first, 'Bitė')).toEqual({ providers: ['Telia', 'Bitė'], default: 'Telia' })
    // A list someone left without a default stays without one.
    expect(withProvider({ providers: ['Telia'], default: '' }, 'Bitė')).toEqual({ providers: ['Telia', 'Bitė'], default: '' })
  })

  it('removing the default leaves none', () => {
    const s = { providers: ['Telia', 'Bitė'], default: 'Telia' }
    expect(withoutProvider(s, 'Telia')).toEqual({ providers: ['Bitė'], default: '' })
    expect(withoutProvider(s, 'Bitė')).toEqual({ providers: ['Telia'], default: 'Telia' })
  })
})

describe('sameProviders', () => {
  it('compares the list in order and the default', () => {
    const s = { providers: ['Telia', 'Bitė'], default: 'Telia' }
    expect(sameProviders(s, { providers: ['Telia', 'Bitė'], default: 'Telia' })).toBe(true)
    expect(sameProviders(s, { providers: ['Bitė', 'Telia'], default: 'Telia' })).toBe(false)
    expect(sameProviders(s, { providers: ['Telia', 'Bitė'], default: '' })).toBe(false)
  })
})
