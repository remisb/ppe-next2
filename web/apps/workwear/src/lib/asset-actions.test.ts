import type { Asset } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { assetActions } from './asset-actions'

const noop = () => {}
const run = { give: noop, return: noop, edit: noop, printForm: noop, notReturned: noop, activationEmail: noop, blockingEmail: noop }
const held = { not_returned_at: null, paper_form_signed: true }

/** Each action's icon, by id. */
function icons(a: Pick<Asset, 'kind' | 'open_assignment' | 'connection_status'>) {
  return Object.fromEntries(assetActions(a, { manage: true }, run).map((x) => [x.id, x.icon]))
}

describe('assetActions: icons (docs/ux/mockups/sim-action-icons.html)', () => {
  it('a SIM card in the office: Give SIM is the card with an arrow out, the emails say which', () => {
    expect(icons({ kind: 'SIM', connection_status: 'NOT_ACTIVATED', open_assignment: null } as Asset)).toEqual({
      give: 'simGive',
      edit: 'edit',
      activationEmail: 'activationEmail',
      blockingEmail: 'blockingEmail',
    })
  })

  it('a held SIM card: Return is the card with an arrow in, Not Returned the card with an alert', () => {
    const a = icons({ kind: 'SIM', connection_status: 'ACTIVE', open_assignment: held } as unknown as Asset)
    expect(a.return).toBe('simReturn')
    expect(a.notReturned).toBe('simNotReturned')
    expect(a.blockingEmail).toBe('blockingEmail')
    expect(a.activationEmail).toBeUndefined()
  })

  it('equipment keeps the plain icons: Give Asset has none, Return the undo arrow, Not Returned none', () => {
    expect(icons({ kind: 'EQUIPMENT', connection_status: null, open_assignment: null } as Asset).give).toBeUndefined()
    const a = icons({ kind: 'EQUIPMENT', connection_status: null, open_assignment: held } as unknown as Asset)
    expect(a.return).toBe('return')
    expect(a.notReturned).toBeUndefined()
  })
})
