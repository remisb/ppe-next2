// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

import { selectedAmong, selectionState, tickedRows, useSelection } from './use-selection.ts'

interface Row {
  id: string
}
const idOf = (r: Row) => r.id
const rows = (...ids: string[]) => ids.map((id) => ({ id }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The hook's latest value, rendered in a component of its own; `rerender` renders it again. */
function renderHook<R>(hook: () => R) {
  const result = { current: undefined as R }
  const root = createRoot(document.body.appendChild(document.createElement('div')))
  const Probe = () => {
    result.current = hook()
    return null
  }
  const rerender = () => act(() => root.render(createElement(Probe)))
  rerender()
  return { result, rerender }
}

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

  it('keeps rows ticked on other pages only across pages, after those shown', () => {
    const kept = new Map(rows('x', 'b').map((r) => [r.id, r]))
    expect(tickedRows(kept, rows('a', 'b'), idOf, false).map(idOf)).toEqual(['b'])
    expect(tickedRows(kept, rows('a', 'b'), idOf, true).map(idOf)).toEqual(['b', 'x'])
  })
})

describe('select mode', () => {
  it('starts with nothing ticked, ticks rows while on, and clears them when it ends', () => {
    const shown = rows('a', 'b', 'c')
    const { result } = renderHook(() => useSelection(shown, idOf))
    expect(result.current.active).toBe(false)
    act(() => result.current.start('export'))
    expect(result.current.mode).toBe('export')
    act(() => result.current.toggle('b'))
    act(() => result.current.toggle('c'))
    act(() => result.current.toggle('b'))
    expect(result.current.ids).toEqual(['c'])
    expect(result.current.state).toBe('some')
    act(() => result.current.setAll(true))
    expect(result.current.state).toBe('all')
    act(() => result.current.end())
    expect(result.current.active).toBe(false)
    expect(result.current.count).toBe(0)
  })

  it('keeps a row ticked on another page when the list pages across', () => {
    let shown = rows('a', 'b')
    const { result, rerender } = renderHook(() => useSelection(shown, idOf, { acrossPages: true }))
    act(() => result.current.start('export'))
    act(() => result.current.toggle('a'))
    shown = rows('c', 'd')
    rerender()
    act(() => result.current.toggle('d'))
    expect(result.current.rows.map(idOf)).toEqual(['d', 'a'])
    expect(result.current.state).toBe('some')
  })
})
