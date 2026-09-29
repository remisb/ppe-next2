import { describe, expect, it } from 'vitest'

import { clothingBands } from './utils'
import { employeeFacts, initials, itemStatus, missingLabel, setTotal } from './records'

describe('initials', () => {
  it('takes the first letter of each name', () => {
    expect(initials({ first_name: 'Aleksandr', last_name: 'Ivanov' })).toBe('AI')
    expect(initials({ first_name: ' ona', last_name: 'Kazlauskienė' })).toBe('OK')
  })
})

describe('employeeFacts', () => {
  it('joins the code and saved sizes, leaving out what is missing', () => {
    const bands = clothingBands([
      { code: '52', band: 'L', min_cm: null, max_cm: null },
      { code: '54', band: 'L', min_cm: null, max_cm: null },
    ])
    expect(employeeFacts({ code: 'W-006', height_cm: 189, clothing_size: 54, shoe_size: '46' }, bands)).toBe('W-006 · 189 cm · Clothing L (52–54) · Shoes 46')
    // A size outside the vocabulary shows as it is.
    expect(employeeFacts({ code: null, height_cm: null, clothing_size: 70, shoe_size: null }, bands)).toBe('Clothing 70')
    expect(employeeFacts({ code: null, height_cm: 171, clothing_size: null, shoe_size: null }, bands)).toBe('171 cm')
    expect(employeeFacts({ code: null, height_cm: null, clothing_size: null, shoe_size: null }, bands)).toBe('')
  })
})

describe('missingLabel', () => {
  it('names the sizes Create Order will ask for', () => {
    expect(missingLabel({ height_cm: 180, clothing_size: null, shoe_size: '42' })).toBeUndefined()
    expect(missingLabel({ height_cm: 180, clothing_size: null, shoe_size: null })).toBe('No shoe size')
    expect(missingLabel({ height_cm: null, clothing_size: null, shoe_size: '42' })).toBe('No clothing size')
    expect(missingLabel({ height_cm: null, clothing_size: null, shoe_size: null })).toBe('No sizes')
  })
})

describe('itemStatus', () => {
  it('is inactive first, then incomplete without a price or period', () => {
    expect(itemStatus({ active: true, unit_price_cents: 4999, service_period_months: 12 })).toBe('active')
    expect(itemStatus({ active: true, unit_price_cents: null, service_period_months: 12 })).toBe('incomplete')
    expect(itemStatus({ active: true, unit_price_cents: 250, service_period_months: null })).toBe('incomplete')
    expect(itemStatus({ active: false, unit_price_cents: null, service_period_months: null })).toBe('inactive')
  })
})

describe('setTotal', () => {
  const lines = [
    { catalogue_item_id: 'shoes', default_quantity: 1, display_order: 1 },
    { catalogue_item_id: 'gloves', default_quantity: 10, display_order: 2 },
  ]
  it('sums default quantities at current prices', () => {
    const items = new Map([['shoes', { unit_price_cents: 4999 }], ['gloves', { unit_price_cents: 250 }]])
    expect(setTotal({ lines }, items)).toEqual({ items: 2, cents: 7499, complete: true })
  })
  it('leaves out an item without a price, and says so', () => {
    const items = new Map([['shoes', { unit_price_cents: 4999 }], ['gloves', { unit_price_cents: null }]])
    expect(setTotal({ lines }, items)).toEqual({ items: 2, cents: 4999, complete: false })
    expect(setTotal({ lines }, new Map()).complete).toBe(false)
  })
})
