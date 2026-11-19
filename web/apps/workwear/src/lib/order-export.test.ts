import type { ListedOrder } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { orderExportColumns } from './order-export'

const given = {
  id: 'o1',
  record_number: 'WE-000012',
  employee_id: 'e1',
  employee_first_name: 'Rūta',
  employee_last_name: 'Petrauskienė',
  employee_code: 'E-022',
  status: 'GIVEN',
  ordered_at: '2026-11-02T08:15:00Z',
  prepared_by_user_id: 'u1',
  prepared_by_name: 'Jonas Manager',
  given_at: '2026-11-05T22:30:00Z',
  given_by_user_id: 'u1',
  given_by_name: 'Jonas Manager',
  confirmation_method: 'PAPER',
  updated_at: '2026-11-05T22:30:00Z',
  receipt_text_version: 'v1',
  lines: [{ quantity: 2 }, { quantity: 1 }],
  total_cents: 4590,
  usage_months: 0,
} as unknown as ListedOrder

describe('orderExportColumns', () => {
  it('starts with the list’s own columns ticked', () => {
    const cols = orderExportColumns('Europe/Vilnius')
    expect(cols.filter((c) => c.shown).map((c) => c.key)).toEqual(['record', 'employee', 'status', 'ordered_at', 'given_at', 'total'])
  })

  it('writes moments in the organisation’s timezone, the total in euros and the items counted', () => {
    const value = Object.fromEntries(orderExportColumns('Europe/Vilnius').map((c) => [c.key, c.value(given)]))
    expect(value).toMatchObject({
      record: 'WE-000012',
      employee: 'Rūta Petrauskienė',
      status: 'Given',
      ordered_at: '2026-11-02 10:15',
      given_at: '2026-11-06 00:30',
      confirmation: 'On paper',
      items: 3,
      total: 45.9,
    })
  })

  it('leaves an ordered order’s giving empty', () => {
    const ordered = { ...given, status: 'ORDERED', given_at: null, given_by_name: null, confirmation_method: null } as ListedOrder
    const value = Object.fromEntries(orderExportColumns(undefined).map((c) => [c.key, c.value(ordered)]))
    expect(value).toMatchObject({ status: 'Ordered', given_at: null, given_by: null, confirmation: null })
  })
})
