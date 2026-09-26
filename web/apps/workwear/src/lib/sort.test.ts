import { describe, expect, it } from 'vitest'

import { nextSort, rankIn, sortRows } from './sort'

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

describe('rankIn', () => {
  it('ranks by vocabulary position, unknown values after known ones, empty as null', () => {
    const sizes = ['S', 'M', 'L', 'XL', '2XL']
    expect(rankIn(sizes, '2XL')).toBe(4)
    expect(rankIn(sizes, 'XS')).toBe(5)
    expect(rankIn(sizes, null)).toBeNull()
  })
})
