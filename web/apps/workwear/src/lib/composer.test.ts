import type { ListedOrder } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { lastOrder, linesText, setOnOrder, sizeParts } from './composer'
import { clothingBands } from './utils'

const bands = clothingBands([
  { code: '44', band: 'S', min_cm: null, max_cm: null },
  { code: '46', band: 'S', min_cm: null, max_cm: null },
  { code: '48', band: 'M', min_cm: null, max_cm: null },
  { code: '50', band: 'M', min_cm: null, max_cm: null },
])

describe('sizeParts', () => {
  it('names each saved size, the clothing size by its band', () => {
    expect(sizeParts({ height_cm: 165, clothing_size: 46, shoe_size: '39' }, bands)).toEqual([
      { label: '165 cm', missing: false },
      { label: 'Clothing S (44–46)', missing: false },
      { label: 'Shoes 39', missing: false },
    ])
  })
  it('suggests clothing from height, and flags what nothing can resolve', () => {
    expect(sizeParts({ height_cm: 180, clothing_size: null, shoe_size: null }, bands)).toEqual([
      { label: '180 cm', missing: false },
      { label: 'Clothing from height', missing: false },
      { label: 'No shoe size', missing: true },
    ])
    expect(sizeParts({ height_cm: null, clothing_size: null, shoe_size: '42' }, bands)).toEqual([
      { label: 'No clothing size', missing: true },
      { label: 'Shoes 42', missing: false },
    ])
  })
  it('keeps a size outside the vocabulary as it is', () => {
    expect(sizeParts({ height_cm: null, clothing_size: 70, shoe_size: '40' }, bands)[0]).toEqual({ label: 'Clothing 70', missing: false })
  })
})

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
