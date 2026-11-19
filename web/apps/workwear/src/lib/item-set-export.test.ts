import type { CatalogueItem, ItemSet } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { itemSetExportColumns, itemSetExportRows } from './item-set-export'

const item = (id: string, name: string, cents: number | null): CatalogueItem => ({
  id,
  name,
  details: '',
  size_group: 'NONE',
  purchase_price_cents: null,
  accounting_price_cents: cents,
  currency: 'EUR',
  service_period_months: 12,
  active: true,
  display_rank: 1,
  icon: 'other',
  supplier_id: null,
  supplier_name: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})
const items = new Map([item('a', 'Jacket', 4250), item('b', 'Helmet', null)].map((i) => [i.id, i]))
const starter: ItemSet = {
  id: 's1',
  name: 'Starter kit',
  description: '',
  active: false,
  lines: [
    { catalogue_item_id: 'a', default_quantity: 2, display_order: 1 },
    { catalogue_item_id: 'b', default_quantity: 1, display_order: 2 },
    { catalogue_item_id: 'gone', default_quantity: 1, display_order: 3 },
  ],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('item set export', () => {
  it('has a row per line of each set, priced at today’s catalogue price', () => {
    const cols = itemSetExportColumns()
    const rows = itemSetExportRows([starter], items).map((r) => Object.fromEntries(cols.map((c) => [c.key, c.value(r)])))
    expect(rows).toMatchObject([
      { set: 'Starter kit', set_status: 'Inactive', item: 'Jacket', quantity: 2, price: 42.5, line_total: 85, service_period: 12 },
      { item: 'Helmet', quantity: 1, price: null, line_total: null },
      { item: 'Deleted item', price: null, line_total: null, service_period: null },
    ])
  })

  it('ticks the set, its status, the item, quantity, price and line total', () => {
    expect(itemSetExportColumns().filter((c) => c.shown).map((c) => c.key)).toEqual(['set', 'set_status', 'item', 'quantity', 'price', 'line_total'])
  })
})
