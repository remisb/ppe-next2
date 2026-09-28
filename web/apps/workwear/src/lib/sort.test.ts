import type { SizeGroup } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { nextSort, sizeRank, sortRows } from './sort'

describe('nextSort', () => {
  const name = { key: 'name', label: 'Name' } as const
  const date = { key: 'date', label: 'Date', firstDir: 'desc' } as const

  it('starts a new column at its first direction, then reverses it', () => {
    expect(nextSort(null, name, true)).toEqual({ key: 'name', dir: 'asc' })
    expect(nextSort({ key: 'name', dir: 'asc' }, name, true)).toEqual({ key: 'name', dir: 'desc' })
    expect(nextSort({ key: 'name', dir: 'asc' }, date, true)).toEqual({ key: 'date', dir: 'desc' })
    expect(nextSort({ key: 'date', dir: 'desc' }, date, true)).toEqual({ key: 'date', dir: 'asc' })
  })

  it('a third click returns to the natural order, or starts over when there is none', () => {
    expect(nextSort({ key: 'name', dir: 'desc' }, name, true)).toBeNull()
    expect(nextSort({ key: 'name', dir: 'desc' }, name, false)).toEqual({ key: 'name', dir: 'asc' })
  })
})

describe('sortRows', () => {
  const rows = [
    { n: 'Ona', code: 'W-10', h: 170 },
    { n: 'jonas', code: null, h: null },
    { n: 'Ąžuolas', code: 'W-9', h: 190 },
    { n: 'Birutė', code: '', h: 160 },
  ]
  const get = (r: (typeof rows)[number], k: 'n' | 'code' | 'h') => r[k]
  const names = (rs: typeof rows) => rs.map((r) => r.n)

  it('keeps the given order without a sort and never mutates the input', () => {
    expect(names(sortRows(rows, null, get))).toEqual(['Ona', 'jonas', 'Ąžuolas', 'Birutė'])
    sortRows(rows, { key: 'n', dir: 'asc' }, get)
    expect(rows[0]!.n).toBe('Ona')
  })

  it('compares text ignoring case and accents, and numbers inside text numerically', () => {
    expect(names(sortRows(rows, { key: 'n', dir: 'asc' }, get))).toEqual(['Ąžuolas', 'Birutė', 'jonas', 'Ona'])
    expect(names(sortRows(rows, { key: 'code', dir: 'asc' }, get))).toEqual(['Ąžuolas', 'Ona', 'jonas', 'Birutė'])
  })

  it('puts empty values last in both directions, ties in the given order', () => {
    expect(names(sortRows(rows, { key: 'h', dir: 'asc' }, get))).toEqual(['Birutė', 'Ona', 'Ąžuolas', 'jonas'])
    expect(names(sortRows(rows, { key: 'h', dir: 'desc' }, get))).toEqual(['Ąžuolas', 'Ona', 'Birutė', 'jonas'])
    expect(names(sortRows(rows, { key: 'code', dir: 'desc' }, get))).toEqual(['Ona', 'Ąžuolas', 'jonas', 'Birutė'])
  })
})

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
