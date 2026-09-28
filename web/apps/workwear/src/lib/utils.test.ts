import { describe, expect, it } from 'vitest'

import { clothingSizeLabel, formatEuro, formatMonths, formatSize, parseEuro } from './utils'

describe('money and display helpers', () => {
  it('formats euros with the € symbol', () => {
    expect(formatEuro(4999)).toBe('€49.99')
    expect(formatEuro(0)).toBe('€0.00')
    expect(formatEuro(null)).toBe('—')
  })
  it('parses euro input', () => {
    expect(parseEuro('49.99')).toBe(4999)
    expect(parseEuro('€ 49,5')).toBe(4950)
    expect(parseEuro('')).toBeNull()
    expect(parseEuro('4.999')).toBeNaN()
    expect(parseEuro('-1')).toBeNaN()
  })
  it('formats months and sizes', () => {
    expect(formatMonths(1)).toBe('1 month')
    expect(formatMonths(12)).toBe('12 months')
    expect(formatSize(null)).toBe('–')
    expect(formatSize(54)).toBe('54')
    expect(formatSize('L')).toBe('L')
  })
  it('labels a clothing size with its height range only when it has one', () => {
    expect(clothingSizeLabel({ code: '46', min_cm: 160, max_cm: 167 })).toBe('46 (160–167 cm)')
    expect(clothingSizeLabel({ code: '44', min_cm: null, max_cm: null })).toBe('44')
  })
})
