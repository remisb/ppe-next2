import { describe, expect, it } from 'vitest'

import { moveBefore, moveTo } from './catalogue-order'

describe('moveTo', () => {
  it('puts one id at another place, the others keeping their order', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
    expect(moveTo(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })
})

describe('moveBefore', () => {
  const all = ['a', 'b', 'c', 'd', 'e']

  it('is the item now after the moved one, in the whole list', () => {
    expect(moveBefore(all, ['a', 'd', 'b', 'c', 'e'], 'd')).toBe('b')
    expect(moveBefore(all, ['b', 'c', 'd', 'e', 'a'], 'a')).toBeNull()
  })

  it('in a list showing only some items, places it among the whole catalogue', () => {
    // A tab shows b, d, e; e dropped in front of d goes in front of d.
    expect(moveBefore(all, ['b', 'e', 'd'], 'e')).toBe('d')
    // b dropped last, under e: in front of whatever follows e in the whole list (nothing: last).
    expect(moveBefore(all, ['d', 'e', 'b'], 'b')).toBeNull()
    // A tab shows b and d; b dropped under d goes in front of e, which follows d in the whole list.
    expect(moveBefore(all, ['d', 'b'], 'b')).toBe('e')
  })
})
