import type { Supplier } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { draftOf, matches, placeOf, toInput, validateSupplier } from './suppliers'

const supplier = (over: Partial<Supplier> = {}): Supplier => ({
  ...draftOf(),
  id: 's1',
  code: 'SUP-1',
  name: 'Darbo rūbai, UAB',
  city: 'Vilnius',
  country: 'LT',
  item_count: 2,
  created_at: '',
  updated_at: '',
  ...over,
})

describe('validateSupplier', () => {
  it('needs a code and a name', () => {
    expect(validateSupplier(draftOf())).toEqual({ code: expect.any(String), name: expect.any(String) })
    expect(validateSupplier({ ...draftOf(), code: ' A ', name: 'B' })).toEqual({})
  })

  it('takes a two-letter country in any case, and an email address', () => {
    const d = { ...draftOf(), code: 'A', name: 'B' }
    expect(validateSupplier({ ...d, country: 'lt' })).toEqual({})
    expect(validateSupplier({ ...d, country: 'LTU' })).toHaveProperty('country')
    expect(validateSupplier({ ...d, email: 'orders@example.lt' })).toEqual({})
    expect(validateSupplier({ ...d, email: 'orders at example' })).toHaveProperty('email')
  })

  it('counts letters, not bytes, against the limits', () => {
    const d = { ...draftOf(), code: 'A', name: 'B' }
    expect(validateSupplier({ ...d, notes: 'ž'.repeat(2000) })).toEqual({})
    expect(validateSupplier({ ...d, notes: 'ž'.repeat(2001) })).toHaveProperty('notes')
  })
})

describe('toInput', () => {
  it('trims every field and puts the country in upper case', () => {
    expect(toInput({ ...draftOf(), code: ' SUP-1 ', name: ' Name ', country: ' lt ' })).toMatchObject({ code: 'SUP-1', name: 'Name', country: 'LT', email: '' })
  })
})

describe('placeOf and matches', () => {
  it('names where a supplier is, as far as known', () => {
    expect(placeOf(supplier())).toBe('Vilnius, LT')
    expect(placeOf(supplier({ city: '' }))).toBe('LT')
    expect(placeOf(supplier({ city: '', country: '' }))).toBe('')
  })

  it('searches the code, name and contact details', () => {
    expect(matches(supplier(), 'sup-1')).toBe(true)
    expect(matches(supplier(), 'rūbai')).toBe(true)
    expect(matches(supplier({ email: 'orders@example.lt' }), 'ORDERS')).toBe(true)
    expect(matches(supplier(), 'kaunas')).toBe(false)
    expect(matches(supplier(), '  ')).toBe(true)
  })
})
