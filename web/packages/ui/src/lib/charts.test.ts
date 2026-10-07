import { describe, expect, it } from 'vitest'

import { barPercent, heatLevel, niceCeiling, sparkPoints } from './charts.ts'

describe('charts', () => {
  it('rounds the scale up', () => {
    expect([0, 3, 19, 230, 4100].map(niceCeiling)).toEqual([1, 5, 20, 250, 5000])
    expect(barPercent(1, 1000)).toBe(2)
    expect(barPercent(0, 10)).toBe(0)
  })

  it('grades heat in four steps, any change at least the first', () => {
    expect([0, 1, 25, 26, 100].map((v) => heatLevel(v, 100))).toEqual([0, 1, 1, 2, 4])
  })

  it('draws a sparkline across the box, highest at the top', () => {
    expect(sparkPoints([0, 5, 10], 100, 20)).toBe('0.0,20.0 50.0,10.0 100.0,0.0')
    expect(sparkPoints([3, 3], 100, 20)).toBe('0.0,10.0 100.0,10.0')
    expect(sparkPoints([], 100, 20)).toBe('')
  })
})
