import { describe, expect, it } from 'vitest'

import {
  MAX_PROVIDERS,
  badEmails,
  emailOk,
  providerProblem,
  sameProviders,
  sameValue,
  tidyProviders,
  valueProblem,
  valueText,
  withDetails,
  withProvider,
  withoutProvider,
} from './sim-providers'

const p = (name: string, email = '', default_plan = '') => ({ name, email, default_plan })

describe('providerProblem', () => {
  it('takes a new name, trimmed', () => {
    expect(providerProblem([p('Telia')], ' Bitė ')).toBeUndefined()
  })

  it('refuses an empty name, one listed in any case, a long one and one too many', () => {
    expect(providerProblem([], '  ')).toBe('empty')
    expect(providerProblem([p('Telia')], ' telia')).toBe('duplicate')
    expect(providerProblem([], 'a'.repeat(101))).toBe('tooLong')
    expect(providerProblem(Array.from({ length: MAX_PROVIDERS }, (_, i) => p(`P${i}`)), 'Bitė')).toBe('tooMany')
  })
})

describe('withProvider and withoutProvider', () => {
  it('makes the first provider the default, and keeps the default after that', () => {
    const first = withProvider({ providers: [], default: '' }, ' Telia ')
    expect(first).toEqual({ providers: [p('Telia')], default: 'Telia' })
    expect(withProvider(first, 'Bitė')).toEqual({ providers: [p('Telia'), p('Bitė')], default: 'Telia' })
    // A list someone left without a default stays without one.
    expect(withProvider({ providers: [p('Telia')], default: '' }, 'Bitė')).toEqual({ providers: [p('Telia'), p('Bitė')], default: '' })
  })

  it('removing the default leaves none', () => {
    const s = { providers: [p('Telia'), p('Bitė')], default: 'Telia' }
    expect(withoutProvider(s, 'Telia')).toEqual({ providers: [p('Bitė')], default: '' })
    expect(withoutProvider(s, 'Bitė')).toEqual({ providers: [p('Telia')], default: 'Telia' })
  })
})

describe('a provider’s e-mail and plan', () => {
  it('changes only that provider, and is saved trimmed', () => {
    const s = { providers: [p('Telia'), p('Bitė')], default: 'Telia' }
    const typed = withDetails(withDetails(s, 'Bitė', { email: ' sim@bite.lt ' }), 'Bitė', { default_plan: 'Verslas ' })
    expect(typed.providers).toEqual([p('Telia'), p('Bitė', ' sim@bite.lt ', 'Verslas ')])
    expect(tidyProviders(typed).providers[1]).toEqual(p('Bitė', 'sim@bite.lt', 'Verslas'))
  })

  it('takes one bare address or none', () => {
    for (const ok of ['', ' ', 'sim@telia.lt', 'verslas.sim+lt@bite.co.uk']) expect(emailOk(ok)).toBe(true)
    for (const bad of ['telia', 'sim@telia', 'Telia <sim@telia.lt>', 'a@telia.lt, b@telia.lt', 'a b@telia.lt']) expect(emailOk(bad)).toBe(false)
    expect(badEmails({ providers: [p('Telia', 'telia'), p('Bitė', 'sim@bite.lt')], default: '' })).toEqual(['Telia'])
  })
})

describe('sameProviders', () => {
  it('compares the list in order, each one’s e-mail and plan as saved, and the default', () => {
    const s = { providers: [p('Telia', 'sim@telia.lt'), p('Bitė')], default: 'Telia' }
    expect(sameProviders(s, { providers: [p('Telia', ' sim@telia.lt'), p('Bitė')], default: 'Telia' })).toBe(true)
    expect(sameProviders(s, { providers: [p('Bitė'), p('Telia', 'sim@telia.lt')], default: 'Telia' })).toBe(false)
    expect(sameProviders(s, { providers: [p('Telia', 'sim@telia.lt'), p('Bitė')], default: '' })).toBe(false)
    expect(sameProviders(s, { providers: [p('Telia'), p('Bitė')], default: 'Telia' })).toBe(false)
    expect(sameProviders(s, { providers: [p('Telia', 'sim@telia.lt'), p('Bitė', '', 'Biz')], default: 'Telia' })).toBe(false)
  })
})

describe('the default Non-return Value', () => {
  it('shows a saved value with two decimals, none as empty', () => {
    expect(valueText(2500)).toBe('25.00')
    expect(valueText(0)).toBe('0.00')
    expect(valueText(null)).toBe('')
  })

  it('takes an amount in euros or nothing, and refuses text and too much', () => {
    expect(valueProblem('')).toBeUndefined()
    expect(valueProblem('25,5')).toBeUndefined()
    expect(valueProblem('€ 25')).toBeUndefined()
    expect(valueProblem('abc')).toBe('invalid')
    expect(valueProblem('-1')).toBe('invalid')
    expect(valueProblem('100000000.01')).toBe('tooLarge')
  })

  it('tells the same amount however it is typed', () => {
    expect(sameValue('25', '25.00')).toBe(true)
    expect(sameValue('25,00', '25.00')).toBe(true)
    expect(sameValue('', '25.00')).toBe(false)
    expect(sameValue('', '')).toBe(true)
    expect(sameValue('abc', '25.00')).toBe(false)
  })
})
