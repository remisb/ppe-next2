import { describe, expect, it } from 'vitest'

import { type BarMeasure, type RecordAction, layoutActions, menuGroups, sortActions } from './record-actions.ts'

// The bar's fixed parts as the app draws them: 44px tools and ⋯, 8px apart.
const base = { toolWidth: 44, moreWidth: 44, gap: 8, maxTools: 3, menu: true } satisfies Partial<BarMeasure>

// An ordered order: Create confirmation link (full 213, short 127, icon 44), Print and Sign, ⋯ with Copy for WhatsApp.
const order = (room: number, extra: Partial<BarMeasure> = {}): BarMeasure => ({
  ...base,
  room,
  main: { full: 213, short: 127, icon: 44 },
  tools: 2,
  ...extra,
})

describe('layoutActions', () => {
  it('keeps the full words and every tool where they fit', () => {
    // 213 + 8 + 44 + 8 + 44 + 8 + 44 = 369
    expect(layoutActions(order(369))).toEqual({ step: 'full', tools: 2, more: true })
  })

  it('takes the short words before moving any tool', () => {
    expect(layoutActions(order(368))).toEqual({ step: 'short', tools: 2, more: true })
    expect(layoutActions(order(283))).toEqual({ step: 'short', tools: 2, more: true })
  })

  it('then moves tools into ⋯, the last first', () => {
    expect(layoutActions(order(282))).toEqual({ step: 'short', tools: 1, more: true })
    expect(layoutActions(order(231))).toEqual({ step: 'short', tools: 1, more: true })
    expect(layoutActions(order(230))).toEqual({ step: 'short', tools: 0, more: true })
  })

  it('makes the main action its icon last of all', () => {
    // 127 + 8 + 44: the short words and ⋯.
    expect(layoutActions(order(179))).toEqual({ step: 'short', tools: 0, more: true })
    // Then the icon, and the tools that fit beside it come back: 44 + 8 + 44 + 8 + 44.
    expect(layoutActions(order(178))).toEqual({ step: 'icon', tools: 1, more: true })
    expect(layoutActions(order(140))).toEqual({ step: 'icon', tools: 0, more: true })
  })

  it('shows ⋯ only when it holds something', () => {
    const edit: BarMeasure = { ...base, room: 400, main: { full: 80, icon: 44 }, tools: 0, menu: false }
    expect(layoutActions(edit)).toEqual({ step: 'full', tools: 0, more: false })
    // A tool moved for want of room brings ⋯ with it.
    const tight: BarMeasure = { ...base, room: 140, main: { full: 100 }, tools: 1, menu: false }
    expect(layoutActions(tight)).toEqual({ step: 'full', tools: 0, more: true })
  })

  it('caps the tools, the rest in ⋯', () => {
    expect(layoutActions(order(1000, { tools: 3, maxTools: 2 }))).toEqual({ step: 'full', tools: 2, more: true })
    expect(layoutActions(order(1000, { tools: 2, maxTools: 2, menu: false }))).toEqual({ step: 'full', tools: 2, more: false })
  })

  it('keeps the words of a main action without an icon', () => {
    const give: BarMeasure = { ...base, room: 100, main: { full: 120 }, tools: 1, menu: true }
    expect(layoutActions(give)).toEqual({ step: 'full', tools: 0, more: true })
  })

  it('lays out tools alone, without a main action', () => {
    expect(layoutActions({ ...base, room: 200, main: null, tools: 2, menu: false })).toEqual({ step: 'full', tools: 2, more: false })
    expect(layoutActions({ ...base, room: 60, main: null, tools: 2, menu: false })).toEqual({ step: 'full', tools: 0, more: true })
  })
})

const act = (id: string, place: RecordAction['place'], more: Partial<RecordAction> = {}): RecordAction => ({ id, label: id, place, run: () => {}, ...more })

describe('menuGroups', () => {
  const actions = sortActions([
    act('link', 'main', { icon: 'link' }),
    act('print', 'tool', { icon: 'print' }),
    act('sign', 'tool', { icon: 'sign' }),
    act('whatsapp', 'menu'),
    act('delete', 'menu', { destructive: true, asks: true }),
  ])
  const ids = (groups: RecordAction[][]) => groups.map((g) => g.map((a) => a.id))

  it('lists the tools not in the bar first, then the menu, then what asks first', () => {
    expect(ids(menuGroups(actions, 2, false))).toEqual([['whatsapp'], ['delete']])
    expect(ids(menuGroups(actions, 1, false))).toEqual([['sign'], ['whatsapp'], ['delete']])
    expect(ids(menuGroups(actions, 0, false))).toEqual([['print', 'sign'], ['whatsapp'], ['delete']])
  })

  it('names every tool on a touch screen', () => {
    expect(ids(menuGroups(actions, 2, true))).toEqual([['print', 'sign'], ['whatsapp'], ['delete']])
  })
})

describe('sortActions', () => {
  it('puts the main action first and makes a tool without an icon, or a destructive one, a ⋯ item', () => {
    const sorted = sortActions([act('a', 'menu'), act('b', 'tool'), act('c', 'tool', { icon: 'delete', destructive: true }), act('d', 'tool', { icon: 'print' }), act('e', 'main')])
    expect(sorted.map((a) => `${a.id}:${a.place}`)).toEqual(['e:main', 'd:tool', 'a:menu', 'b:menu', 'c:menu'])
  })

  it('refuses two main actions', () => {
    expect(() => sortActions([act('a', 'main'), act('b', 'main')])).toThrow(/one main action/)
  })
})
