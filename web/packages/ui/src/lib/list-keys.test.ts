import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

import { isTyping, stepTo, useCloseFilteredOut, useMarkedRow } from './list-keys.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('stepTo', () => {
  it('steps through the list as shown and stops at its ends', () => {
    const ids = ['a', 'b', 'c']
    expect([stepTo(ids, 'b', 'j'), stepTo(ids, 'b', 'k')]).toEqual(['c', 'a'])
    expect([stepTo(ids, 'c', 'j'), stepTo(ids, 'a', 'k')]).toEqual([undefined, undefined])
    expect(stepTo(ids, 'x', 'j')).toBeUndefined()
  })
})

describe('isTyping', () => {
  it('is a field or editable content, not the page', () => {
    expect(isTyping(document.createElement('input'))).toBe(true)
    expect(isTyping(document.createElement('button'))).toBe(false)
    expect(isTyping(null)).toBe(false)
  })
})

describe('useCloseFilteredOut', () => {
  interface Screen {
    filters: string
    current: boolean
    ids: string[] | undefined
    selected: string | undefined
  }

  /** A list screen with the hook: `show` renders it as given; `closes` counts the times it closed the open record. */
  function screen(first: Screen) {
    const root = createRoot(document.body.appendChild(document.createElement('div')))
    const seen = { closes: 0 }
    const Probe = (props: Screen) => {
      useCloseFilteredOut({ ...props, onClose: () => seen.closes++ })
      return null
    }
    const show = (s: Screen) => act(() => root.render(createElement(Probe, s)))
    show(first)
    return { seen, show }
  }

  it('closes a record the list for new filters does not show, once that list is shown', () => {
    const { seen, show } = screen({ filters: 'viktor', current: true, ids: ['a', 'b'], selected: 'a' })
    // The filters changed; the list before them is still on screen while theirs loads.
    show({ filters: 'tadas', current: false, ids: ['a', 'b'], selected: 'a' })
    expect(seen.closes).toBe(0)
    show({ filters: 'tadas', current: true, ids: ['c', 'd'], selected: 'a' })
    expect(seen.closes).toBe(1)
    // The same list again (a reload, another render) closes nothing more.
    show({ filters: 'tadas', current: true, ids: ['c', 'd'], selected: undefined })
    expect(seen.closes).toBe(1)
  })

  it('keeps a record the list for new filters still shows', () => {
    const { seen, show } = screen({ filters: 'all', current: true, ids: ['a', 'b'], selected: 'a' })
    show({ filters: 'ordered', current: true, ids: ['a'], selected: 'a' })
    expect(seen.closes).toBe(0)
  })

  it('never checks the filters the screen opened with, nor a record opened after a check', () => {
    // A link or ⌘K opened a record the list does not show.
    const { seen, show } = screen({ filters: 'all', current: true, ids: ['a'], selected: 'z' })
    show({ filters: 'all', current: true, ids: ['a', 'b'], selected: 'z' })
    expect(seen.closes).toBe(0)
    show({ filters: 'given', current: true, ids: ['b'], selected: undefined })
    show({ filters: 'given', current: true, ids: ['b'], selected: 'y' })
    expect(seen.closes).toBe(0)
  })

  it('waits for a first list, and closes nothing when the filters come back before theirs is shown', () => {
    const { seen, show } = screen({ filters: 'a', current: false, ids: undefined, selected: 'x' })
    show({ filters: 'b', current: false, ids: undefined, selected: 'x' })
    show({ filters: 'a', current: true, ids: ['y'], selected: 'x' })
    expect(seen.closes).toBe(0)
  })
})

describe('useMarkedRow', () => {
  /** The hook rendered with `selected` and `filters`; `show` renders it again and answers the row it marks. */
  function list(selected: string | undefined, filters: string) {
    const root = createRoot(document.body.appendChild(document.createElement('div')))
    const seen = { marked: undefined as string | undefined }
    const Probe = (props: { selected: string | undefined; filters: string }) => {
      seen.marked = useMarkedRow(props.selected, props.filters)
      return null
    }
    const show = (s: string | undefined, f: string) => {
      act(() => root.render(createElement(Probe, { selected: s, filters: f })))
      return seen.marked
    }
    show(selected, filters)
    return show
  }

  it('marks the open row, and the one just closed', () => {
    const show = list(undefined, 'all')
    expect(show(undefined, 'all')).toBeUndefined()
    expect(show('a', 'all')).toBe('a')
    expect(show(undefined, 'all')).toBe('a')
    // Opening another moves the mark.
    expect(show('b', 'all')).toBe('b')
    expect(show(undefined, 'all')).toBe('b')
  })

  it('forgets the closed row when the filters change, not while one is open', () => {
    const show = list('a', 'all')
    // A record the new filters still list stays open, and stays marked once closed.
    expect(show('a', 'given')).toBe('a')
    expect(show(undefined, 'given')).toBe('a')
    expect(show(undefined, 'ordered')).toBeUndefined()
    expect(show(undefined, 'given')).toBeUndefined()
  })
})
