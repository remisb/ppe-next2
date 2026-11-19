import type { CatalogueItem } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { catalogueExportColumns } from './catalogue-export'

const gloves: CatalogueItem = {
  id: 'i1',
  name: 'Work gloves',
  details: '',
  size_group: 'NONE',
  purchase_price_cents: 250,
  accounting_price_cents: 395,
  currency: 'EUR',
  service_period_months: 3,
  active: true,
  display_rank: 10,
  icon: 'gloves',
  supplier_id: 's1',
  supplier_name: 'Safety UAB',
  created_at: '2026-03-01T22:30:00Z',
  updated_at: '2026-03-01T22:30:00Z',
}

describe('catalogueExportColumns', () => {
  it('offers every field, the list’s own columns ticked', () => {
    const cols = catalogueExportColumns()
    expect(cols.map((c) => c.key)).toEqual(['name', 'details', 'size_group', 'supplier', 'purchase_price', 'price', 'service_period', 'status', 'display_order', 'added'])
    expect(cols.filter((c) => c.shown).map((c) => c.key)).toEqual(['name', 'details', 'size_group', 'price', 'service_period', 'status'])
  })

  it('writes prices in euros, the period in months and the day added in the organisation’s timezone', () => {
    const value = Object.fromEntries(catalogueExportColumns('Europe/Vilnius').map((c) => [c.key, c.value(gloves)]))
    expect(value).toMatchObject({
      details: null,
      size_group: 'No size',
      supplier: 'Safety UAB',
      purchase_price: 2.5,
      price: 3.95,
      service_period: 3,
      status: 'Active',
      display_order: 10,
      added: '2026-03-02',
    })
  })

  it('says an item without a price is Incomplete, with an empty price cell', () => {
    const value = Object.fromEntries(catalogueExportColumns().map((c) => [c.key, c.value({ ...gloves, accounting_price_cents: null })]))
    expect(value).toMatchObject({ price: null, status: 'Incomplete' })
  })
})
