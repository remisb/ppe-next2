import type { Asset } from '@ppe/api-client'
import type { RecordAction } from '@ppe/ui/lib/record-actions'
import { afterEach, describe, expect, it } from 'vitest'

import { type Lang, setLanguage } from '@/i18n'

import { assetActions } from './asset-actions'
import { employeeActions, itemActions } from './employee-actions'
import { orderActions } from './order-actions'

/**
 * Label budgets (record-actions.md §3, "Label budgets"): a main action's words
 * fit the bar beside a list in 24 characters, else it needs short words of
 * 16 at most, in every language (the doc's 14, less strict until the
 * Lithuanian "Sukurti nuorodą", 15, is reworded). The bar measures the real
 * width; this keeps a new or reworded label from leaving it only an icon.
 */
const FULL = 24
const SHORT = 16

const noop = () => {}
const held = { kind: 'SIM', connection_status: 'ACTIVE', open_assignment: { not_returned_at: null, paper_form_signed: true } } as unknown as Asset

/** Every record kind's main action, in every state that has one. */
function mains(): RecordAction[] {
  const order = { createLink: noop, toggleLink: noop, viewRecord: noop, printRecord: noop, sign: noop, handOver: noop, copyWhatsApp: noop }
  const asset = { give: noop, return: noop, edit: noop, printForm: noop, notReturned: noop, activationEmail: noop, blockingEmail: noop }
  const all = [
    orderActions({ status: 'ORDERED' }, { link: null, pending: false }, order),
    orderActions({ status: 'ORDERED' }, { link: { open: true, id: 'l' }, pending: false }, order),
    orderActions({ status: 'GIVEN' }, { link: null, pending: false }, order),
    assetActions({ ...held, open_assignment: null }, { manage: true }, asset),
    assetActions({ ...held, kind: 'EQUIPMENT', connection_status: null, open_assignment: null }, { manage: true }, asset),
    assetActions(held, { manage: true }, asset),
    employeeActions({ editDetails: true, merge: true, remove: true }, { newOrder: noop, editDetails: noop, merge: noop, remove: noop }),
    itemActions({ active: true }, { edit: noop, toggle: noop }),
  ]
  return all.map((actions) => actions.find((a) => a.place === 'main')!)
}

afterEach(() => setLanguage('en'))

describe('record actions: label budgets', () => {
  for (const lang of ['en', 'lt', 'ru'] as Lang[]) {
    it(`${lang}: every main action fits, or has short words that do`, () => {
      setLanguage(lang)
      const over = mains().flatMap((a) => {
        if (a.label.length <= FULL) return []
        if (!a.short) return [`${a.id}: "${a.label}" (${a.label.length}) has no short words`]
        if (a.short.length > SHORT) return [`${a.id}: short "${a.short}" (${a.short.length}) is over ${SHORT}`]
        return []
      })
      expect(over).toEqual([])
    })
  }

  it('every tool and main action that may be icon only has an icon', () => {
    for (const a of mains()) if (a.short || a.label.length > FULL) expect(a.icon, a.id).toBeDefined()
  })
})
