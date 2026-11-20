import { describe, expect, it } from 'vitest'

import { type OrderRunners, orderActions } from './order-actions'

const noop = () => {}
const run: OrderRunners = { createLink: noop, toggleLink: noop, viewRecord: noop, printRecord: noop, sign: noop, handOver: noop, copyWhatsApp: noop }
const places = (actions: ReturnType<typeof orderActions>) => actions.map((a) => `${a.id}:${a.place}`)

describe('orderActions', () => {
  it('ordered: Create confirmation link, Print and Sign as tools, WhatsApp in ⋯', () => {
    expect(places(orderActions({ status: 'ORDERED' }, { link: null, pending: false }, run))).toEqual([
      'createLink:main',
      'printRecord:tool',
      'sign:tool',
      'copyWhatsApp:menu',
    ])
  })

  it('ordered, a link made here: the main action shows and hides it', () => {
    const [main] = orderActions({ status: 'ORDERED' }, { link: { open: true, id: 'l1' }, pending: false }, run)
    expect(main).toMatchObject({ id: 'confirmationLink', place: 'main', expanded: true, controls: 'l1' })
  })

  it('given: View Order, Print as a tool, never a confirmation action', () => {
    expect(places(orderActions({ status: 'GIVEN' }, { link: null, pending: false }, run))).toEqual(['viewRecord:main', 'printRecord:tool', 'copyWhatsApp:menu'])
  })

  it('a manager: Delete order last, destructive and asking first', () => {
    const actions = orderActions({ status: 'GIVEN' }, { link: null, pending: false }, { ...run, remove: noop })
    expect(actions.at(-1)).toMatchObject({ id: 'delete', place: 'menu', destructive: true, asks: true })
  })

  it('every main action has short words', () => {
    for (const state of [{ link: null, pending: false }, { link: { open: false, id: 'l' }, pending: false }]) {
      for (const status of ['ORDERED', 'GIVEN'] as const) expect(orderActions({ status }, state, run)[0]!.short).toBeTruthy()
    }
  })
})
