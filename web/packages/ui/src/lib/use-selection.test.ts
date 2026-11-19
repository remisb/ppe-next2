import { describe, expect, it } from 'vitest'

import { selectedAmong, selectionState } from './use-selection.ts'

describe('selection', () => {
  it('counts only the ticked rows still shown, in the list’s order', () => {
    expect(selectedAmong(new Set(['c', 'a', 'x']), ['a', 'b', 'c'])).toEqual(['a', 'c'])
  })

  it('says whether none, some or all of what is shown is ticked', () => {
    expect(selectionState(0, 3)).toBe('none')
    expect(selectionState(2, 3)).toBe('some')
    expect(selectionState(3, 3)).toBe('all')
    expect(selectionState(0, 0)).toBe('none')
  })
})
