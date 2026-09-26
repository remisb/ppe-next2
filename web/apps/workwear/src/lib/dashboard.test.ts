import { describe, expect, it } from 'vitest'

import { barPercent, changeText, formatDays, monthLabel, niceCeiling, percentChange, plural, share } from './dashboard'

describe('dashboard display rules', () => {
  it('labels months short or with the year', () => {
    expect(monthLabel('2026-09')).toBe('Sep')
    expect(monthLabel('2025-12', true)).toBe('Dec 2025')
  })

  it('compares with the previous month only when it had something', () => {
    expect(percentChange(150, 100)).toBe(50)
    expect(percentChange(0, 100)).toBe(-100)
    expect(percentChange(10, 0)).toBeNull()
    expect(changeText(112, 100, '2026-08')).toBe('+12% vs Aug')
    expect(changeText(95, 100, '2026-08')).toBe('−5% vs Aug')
    expect(changeText(100, 100, '2026-08')).toBe('same as Aug')
    expect(changeText(100, 0, '2026-08')).toBe('')
  })

  it('rounds a chart scale up to 1, 2, 2.5 or 5 times a power of ten', () => {
    expect(niceCeiling(0)).toBe(1)
    expect(niceCeiling(7)).toBe(10)
    expect(niceCeiling(180)).toBe(200)
    expect(niceCeiling(2100)).toBe(2500)
    expect(niceCeiling(4999)).toBe(5000)
    expect(niceCeiling(5001)).toBe(10000)
    expect(niceCeiling(100)).toBe(100)
  })

  it('draws bars within the scale, with a sliver for small non-zero values', () => {
    expect(barPercent(0, 100)).toBe(0)
    expect(barPercent(50, 100)).toBe(50)
    expect(barPercent(1, 1000)).toBe(2)
    expect(barPercent(150, 100)).toBe(100)
  })

  it('formats days, shares and counts', () => {
    expect(formatDays(null)).toBe('—')
    expect(formatDays(0)).toBe('today')
    expect(formatDays(1)).toBe('1 day')
    expect(formatDays(2.5)).toBe('2.5 days')
    expect(share(1, 3)).toBe(33)
    expect(share(1, 0)).toBe(0)
    expect(plural(1, 'order')).toBe('1 order')
    expect(plural(2, 'item')).toBe('2 items')
  })
})
