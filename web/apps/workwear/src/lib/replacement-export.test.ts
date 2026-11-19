import type { DashboardReplacement } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { replacementExportColumns } from './replacement-export'

const due: DashboardReplacement = {
  employee_id: 'e1',
  employee_name: 'Ona Kazlauskienė',
  employee_code: 'E-007',
  catalogue_item_id: 'i1',
  item_name: 'Work boots',
  size: '39',
  quantity: 1,
  order_id: 'o1',
  record_number: 'WE-000012',
  given_at: '2025-11-19T09:00:00Z',
  due_at: '2026-11-18T22:30:00Z',
  overdue: true,
}

describe('replacementExportColumns', () => {
  it('leaves out the employee’s code without See employee profiles', () => {
    expect(replacementExportColumns({ profile: true }).map((c) => c.key)).toEqual(['employee', 'code', 'item', 'size', 'quantity', 'status', 'due', 'given', 'receipt'])
    expect(replacementExportColumns({ profile: false }).map((c) => c.key)).not.toContain('code')
  })

  it('writes the days in the organisation’s timezone and whether it is overdue', () => {
    const value = Object.fromEntries(replacementExportColumns({ profile: true }, 'Europe/Vilnius').map((c) => [c.key, c.value(due)]))
    expect(value).toMatchObject({ employee: 'Ona Kazlauskienė', code: 'E-007', quantity: 1, status: 'Overdue', due: '2026-11-19', given: '2025-11-19', receipt: 'WE-000012' })
  })
})
