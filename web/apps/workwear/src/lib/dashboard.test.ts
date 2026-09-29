import { describe, expect, it } from 'vitest'

import { t } from '@/i18n'

import { type Need, barPercent, missingSizesText, changeText, formatDays, monthLabel, niceCeiling, percentChange, periodLabel, share, sortNeeds } from './dashboard'

describe('dashboard display rules', () => {
  it('labels months short or with the year', () => {
    expect(monthLabel('2026-09')).toBe('Sep')
    expect(monthLabel('2025-12', true)).toBe('Dec 2025')
  })

  it('compares with the previous month only when it had something', () => {
    expect(percentChange(150, 100)).toBe(50)
    expect(percentChange(0, 100)).toBe(-100)
    expect(percentChange(10, 0)).toBeNull()
    expect(changeText(112, 100, '2026-08', 27)).toBe('+12% vs 1–27 Aug')
    expect(changeText(95, 100, '2026-08', 31)).toBe('−5% vs Aug')
    expect(changeText(100, 100, '2026-08', 27)).toBe('same as 1–27 Aug')
    expect(changeText(100, 0, '2026-08', 27)).toBe('')
    // The first instant of a month compares with nothing.
    expect(changeText(100, 100, '2026-08', 0)).toBe('')
  })

  it('names the days of the previous month a comparison covers', () => {
    expect(periodLabel('2026-08', 27)).toBe('1–27 Aug')
    expect(periodLabel('2026-08', 1)).toBe('1 Aug')
    expect(periodLabel('2026-02', 28)).toBe('Feb')
    expect(periodLabel('2028-02', 28)).toBe('1–28 Feb') // a leap year
    expect(periodLabel('2026-12', 31)).toBe('Dec')
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
    // Counts come from the dictionary now; the English is unchanged.
    expect(t.common.orders(1)).toBe('1 order')
    expect(t.common.items(2)).toBe('2 items')
  })
})

describe('needs you', () => {
  const need = (key: string, urgent: boolean): Need => ({
    key,
    urgent,
    tag: '',
    title: key,
    detail: '',
    action: { label: 'Open', context: key, to: { name: 'history' } },
  })
  it('puts the urgent first and keeps each group in its given order', () => {
    const sorted = sortNeeds([need('wait 3d', false), need('wait 20d', true), need('due soon', false), need('overdue', true)])
    expect(sorted.map((n) => n.key)).toEqual(['wait 20d', 'overdue', 'wait 3d', 'due soon'])
  })
})

describe('missing sizes tile', () => {
  it('names the one person and what they miss, or counts several', () => {
    expect(missingSizesText(0)).toBe('Every employee has their sizes.')
    expect(missingSizesText(1, { employee_name: 'Rasa Stankevičiūtė', clothing: false, shoes: true })).toBe('Rasa Stankevičiūtė: no shoe size')
    expect(missingSizesText(1, { employee_name: 'Tomas J', clothing: true, shoes: false })).toBe('Tomas J: no clothing size or height')
    expect(missingSizesText(1, { employee_name: 'Eli', clothing: true, shoes: true })).toBe('Eli: no shoe size, clothing size or height')
    expect(missingSizesText(3, { employee_name: 'Eli', clothing: true, shoes: true })).toBe('3 employees without a size Create Order needs')
  })
})
