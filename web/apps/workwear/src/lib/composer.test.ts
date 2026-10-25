import type { ListedOrder } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { lastOrder, linesText, setOnOrder } from './composer'

describe('lastOrder', () => {
  const o = (id: string, ordered_at: string) => ({ id, ordered_at }) as ListedOrder
  it('is the latest ordered, whatever the list order', () => {
    expect(lastOrder([o('a', '2026-07-30T10:00:00Z'), o('b', '2026-09-01T10:00:00Z'), o('c', '2026-08-15T10:00:00Z')])?.id).toBe('b')
    expect(lastOrder([])).toBeUndefined()
  })
})

describe('setOnOrder', () => {
  const set = { lines: [{ catalogue_item_id: 'shoes', default_quantity: 1, display_order: 1 }, { catalogue_item_id: 'jacket', default_quantity: 1, display_order: 2 }] }
  it('is true only when every item of the set is on the order', () => {
    expect(setOnOrder(set, [{ catalogueItemId: 'shoes' }, { catalogueItemId: 'jacket' }, { catalogueItemId: 'gloves' }])).toBe(true)
    expect(setOnOrder(set, [{ catalogueItemId: 'shoes' }])).toBe(false)
    expect(setOnOrder({ lines: [] }, [{ catalogueItemId: 'shoes' }])).toBe(false)
  })
})

describe('linesText', () => {
  it('counts lines', () => {
    expect(linesText(1)).toBe('1 line')
    expect(linesText(5)).toBe('5 lines')
  })
})
