import { describe, expect, it } from 'vitest'

import { formatEuro, formatMonths, formatSize, parseEuro } from './utils'

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
  })
})
