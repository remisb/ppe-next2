import { describe, expect, it } from 'vitest'

import type { Due, EmployeeItem } from './employee-items'
import { itemsGivenExportColumns } from './items-given-export'

const line = (key: string): EmployeeItem => ({
  key,
  orderId: 'o1',
  catalogueItemId: 'i1',
  recordNumber: 'WE-000012',
  status: 'GIVEN',
  at: '2026-05-04T21:15:00Z',
  itemName: 'Work boots',
  itemDetails: 'S3',
  sizeGroup: 'SHOES',
  size: '39',
  quantity: 1,
  servicePeriodMonths: 12,
  usageMonths: 6.5,
})

describe('itemsGivenExportColumns', () => {
  it('writes each line as the table shows it, the replacement as a day or what became of it', () => {
    const latest = line('a')
    const due = new Map<string, Due>([['a', { item: latest, dueAt: new Date('2027-05-04T21:15:00Z'), overdue: false, dueSoon: false, used: 0.5, reordered: false }]])
    const cols = itemsGivenExportColumns(due, 'Europe/Vilnius')
    const row = (i: EmployeeItem) => Object.fromEntries(cols.map((c) => [c.key, c.value(i)]))
    expect(row(latest)).toEqual({
      item: 'Work boots',
      details: 'S3',
      size: '39',
      quantity: 1,
      given: '2026-05-05 00:15',
      usage: 6.5,
      service_period: 12,
      replacement: '2027-05-05',
      receipt: 'WE-000012',
    })
    // An older line of an item given again since.
    expect(row(line('old')).replacement).toBe('Replaced')
    expect(cols.filter((c) => !c.shown).map((c) => c.key)).toEqual(['details'])
  })
})
