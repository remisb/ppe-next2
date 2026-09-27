import type { ListedOrder, OrderLine } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { addMonths, employeeItems, replacementsDue } from './employee-items'

function line(no: number, name: string): OrderLine {
  return {
    id: `line-${name}`,
    line_no: no,
    catalogue_item_id: `item-${name}`,
    item_name: name,
    item_details: `${name} details`,
    size_group: 'NONE',
    size: null,
    quantity: 1,
    unit_price_cents: 100,
    currency: 'EUR',
    service_period_months: 6,
  }
}

function order(id: string, status: ListedOrder['status'], lines: OrderLine[]): ListedOrder {
  return {
    id,
    record_number: `WE-${id}`,
    employee_id: 'e1',
    employee_first_name: 'Jonas',
    employee_last_name: 'Petraitis',
    employee_code: null,
    status,
    ordered_at: `2026-01-0${id}T08:00:00Z`,
    prepared_by_user_id: 'u1',
    prepared_by_name: 'Admin',
    given_at: status === 'GIVEN' ? `2026-02-0${id}T08:00:00Z` : null,
    given_by_user_id: status === 'GIVEN' ? 'u1' : null,
    given_by_name: status === 'GIVEN' ? 'Admin' : null,
    confirmation_method: status === 'GIVEN' ? 'PAPER' : null,
    updated_at: '2026-02-01T08:00:00Z',
    lines,
    total_cents: 100 * lines.length,
    usage_months: status === 'GIVEN' ? 1.5 : null,
  }
}

describe('employeeItems', () => {
  it('splits lines into given and ordered, keeping order and line order', () => {
    const { given, ordered } = employeeItems([
      order('3', 'ORDERED', [line(1, 'Gloves')]),
      order('2', 'GIVEN', [line(2, 'Helmet'), line(1, 'Jacket')]),
      order('1', 'GIVEN', [line(1, 'Shoes')]),
    ])
    expect(given.map((i) => i.itemName)).toEqual(['Jacket', 'Helmet', 'Shoes'])
    expect(ordered.map((i) => i.itemName)).toEqual(['Gloves'])
  })

  it('dates given items by given_at and ordered items by ordered_at, linking each to its order', () => {
    const { given, ordered } = employeeItems([order('2', 'GIVEN', [line(1, 'Jacket')]), order('3', 'ORDERED', [line(1, 'Gloves')])])
    expect(given[0]).toMatchObject({ orderId: '2', recordNumber: 'WE-2', at: '2026-02-02T08:00:00Z', usageMonths: 1.5 })
    expect(ordered[0]).toMatchObject({ orderId: '3', at: '2026-01-03T08:00:00Z', usageMonths: null })
  })

  it('returns empty lists for no orders', () => {
    expect(employeeItems([])).toEqual({ given: [], ordered: [] })
  })
})

describe('replacements due', () => {
  it('adds months as Postgres does, ending a short month on its last day', () => {
    expect(addMonths('2026-01-31T10:00:00Z', 1).toISOString()).toBe('2026-02-28T10:00:00.000Z')
    expect(addMonths('2028-01-31T10:00:00Z', 1).toISOString()).toBe('2028-02-29T10:00:00.000Z')
    expect(addMonths('2026-07-30T08:00:00Z', 12).toISOString()).toBe('2027-07-30T08:00:00.000Z')
  })

  it('takes the latest given line per item, and says how far through its service period it is', () => {
    // Order 1 gave gloves on 1 February; order 2 gave gloves again and a helmet on 2 February.
    const gloves = { ...line(1, 'gloves'), service_period_months: 1 }
    const helmet = { ...line(2, 'helmet'), service_period_months: 12 }
    const orders = [order('2', 'GIVEN', [gloves, helmet]), order('1', 'GIVEN', [{ ...gloves, id: 'old-gloves' }])]
    const due = replacementsDue(orders, new Date('2026-03-15T08:00:00Z'))
    expect(due.map((d) => d.item.itemName)).toEqual(['gloves', 'helmet'])
    const [g, h] = due
    expect(g?.item.key).toBe('line-gloves') // the later line, from order 2
    expect(g?.dueAt.toISOString()).toBe('2026-03-02T08:00:00.000Z')
    expect(g?.overdue).toBe(true)
    expect(g?.used).toBe(1)
    expect(h?.overdue).toBe(false)
    expect(h?.dueSoon).toBe(false)
    expect(h?.used).toBeCloseTo(41 / 365, 2)
  })

  it('marks an item already on an ORDERED order as reordered', () => {
    const gloves = { ...line(1, 'gloves'), service_period_months: 1 }
    const orders = [order('3', 'ORDERED', [{ ...gloves, id: 'new-gloves' }]), order('1', 'GIVEN', [gloves])]
    const [g] = replacementsDue(orders, new Date('2026-03-15T08:00:00Z'))
    expect(g?.reordered).toBe(true)
    expect(g?.dueSoon).toBe(true)
  })
})
