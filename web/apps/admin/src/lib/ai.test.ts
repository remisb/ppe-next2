import { describe, expect, it } from 'vitest'

import { budgetShare, formatUSD, microFromUSD, monthsTo, priceOf, totalTokens, usdInput } from './ai'

describe('AI money', () => {
  it('reads dollars as typed, with a point or a comma', () => {
    expect(microFromUSD('')).toBeNull()
    expect(microFromUSD(' 20 ')).toBe(20_000_000)
    expect(microFromUSD('$2.5')).toBe(2_500_000)
    expect(microFromUSD('1 000,25')).toBe(1_000_250_000)
    expect(microFromUSD('2.555')).toBeUndefined()
    expect(microFromUSD('-1')).toBeUndefined()
    expect(microFromUSD('ten')).toBeUndefined()
  })

  it('shows the budget field as dollars and cents', () => {
    expect(usdInput(null)).toBe('')
    expect(usdInput(20_000_000)).toBe('20.00')
    expect(usdInput(132_800)).toBe('0.13')
  })

  it('formats cost, finer for a call', () => {
    expect(formatUSD(132_800)).toContain('0.13')
    expect(formatUSD(132_800, true)).toContain('0.1328')
  })

  it('reads a price a million tokens, up to 10 000', () => {
    expect(priceOf('8')).toBe(8)
    expect(priceOf('2,50')).toBe(2.5)
    expect(priceOf('2.')).toBeUndefined()
    expect(priceOf('10001')).toBeUndefined()
    expect(priceOf(undefined)).toBeUndefined()
  })

  it('shares the budget, capped at all of it', () => {
    expect(budgetShare(5, null)).toBeNull()
    expect(budgetShare(5, 0)).toBe(1)
    expect(budgetShare(5, 10)).toBe(0.5)
    expect(budgetShare(50, 10)).toBe(1)
  })

  it('lists the months up to this one, across a year', () => {
    expect(monthsTo('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02'])
    expect(monthsTo('2026-11', 12)).toHaveLength(12)
    expect(monthsTo('2026-11', 12)[0]).toBe('2025-12')
  })

  it('adds a call’s tokens', () => {
    expect(totalTokens({ input_text: 1, input_image: 2, output_text: 3, output_image: 4 })).toBe(10)
  })
})
