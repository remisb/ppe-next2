import type { SizeGroup } from '@ppe/api-client'
import { sortRows } from '@ppe/ui/lib/sort'
import { describe, expect, it } from 'vitest'

import { sizeRank } from './sort'

describe('sizeRank', () => {
  it('sorts clothing by EU number, old letter sizes beside the number they became, then shoes', () => {
    const lines: [SizeGroup, string | null][] = [
      ['SHOES', '44'], ['CLOTHING', '56'], ['CLOTHING', 'L'], ['CLOTHING', '44'], ['CLOTHING', '54'],
      ['CLOTHING', '3XL'], ['SHOES', '39'], ['NONE', null], ['CLOTHING', 'XS'],
    ]
    const sorted = sortRows(lines, { key: 'size', dir: 'asc' }, ([g, s]) => sizeRank(g, s))
    expect(sorted.map(([g, s]) => `${g[0]}${s ?? '–'}`)).toEqual(['C44', 'C54', 'CL', 'C56', 'C3XL', 'CXS', 'S39', 'S44', 'N–'])
  })

  it('reads a size by its group, never by whether it looks like a number', () => {
    expect(sizeRank('CLOTHING', '44')).toBe(44)
    expect(sizeRank('SHOES', '44')).toBe(1044)
    expect(sizeRank('CLOTHING', 'toString')).toBe(999)
    expect(sizeRank('CLOTHING', null)).toBeNull()
    expect(sizeRank('NONE', null)).toBeNull()
  })
})
