import { describe, expect, it } from 'vitest'

import { clothingBandValue, clothingBands, formatEuro, formatMonths, formatSize, parseEuro } from './utils'

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
  it('offers clothing sizes as letter bands storing the larger size', () => {
    const letters = ['S', 'M', 'L', 'XL', '2XL', '3XL']
    const sizes = Array.from({ length: 12 }, (_, i) => ({ code: String(44 + 2 * i), band: letters[i >> 1]!, min_cm: null, max_cm: null }))
    const bands = clothingBands(sizes)
    expect(bands.map((b) => b.label)).toEqual(['S (44–46)', 'M (48–50)', 'L (52–54)', 'XL (56–58)', '2XL (60–62)', '3XL (64–66)'])
    expect(bands.map((b) => b.value)).toEqual(['46', '50', '54', '58', '62', '66'])
    expect(clothingBandValue(bands, 44)).toBe('46')
    expect(clothingBandValue(bands, '54')).toBe('54')
    expect(clothingBandValue(bands, null)).toBe('')
    // A letter size of an old order line has no band.
    expect(clothingBandValue(bands, 'M')).toBe('M')
  })
})
