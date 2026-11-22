import type { Company } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { deleteRefusal, draftOf, matches, placeOf, toInput, validateCompany } from './companies'

const company = (over: Partial<Company> = {}): Company => ({
  ...draftOf(),
  id: 'c1',
  code: 'GV',
  name: 'UAB Gavort',
  vat_code: 'LT100000000001',
  city: 'Vilnius',
  country: 'LT',
  is_default: false,
  employee_count: 0,
  created_at: '',
  updated_at: '',
  ...over,
})

describe('validateCompany', () => {
  it('needs a name, not a code', () => {
    expect(validateCompany(draftOf())).toEqual({ name: expect.any(String) })
    expect(validateCompany({ ...draftOf(), name: ' UAB Gavort ' })).toEqual({})
  })

  it('takes a two-letter country in any case', () => {
    const d = { ...draftOf(), name: 'A' }
    expect(validateCompany({ ...d, country: 'lt' })).toEqual({})
    expect(validateCompany({ ...d, country: 'LTU' })).toHaveProperty('country')
  })

  it('refuses what is too long', () => {
    expect(validateCompany({ ...draftOf(), name: 'a'.repeat(201) })).toHaveProperty('name')
    expect(validateCompany({ ...draftOf(), name: 'A', code: 'c'.repeat(33) })).toHaveProperty('code')
  })
})

describe('toInput', () => {
  it('trims and puts the country in upper case', () => {
    expect(toInput({ ...draftOf(), name: ' A ', country: ' lt ' })).toMatchObject({ name: 'A', country: 'LT' })
  })
})

describe('the list', () => {
  it('reads a place and searches by code, name, codes and city', () => {
    expect(placeOf(company())).toBe('Vilnius, LT')
    expect(placeOf(company({ city: '' }))).toBe('LT')
    expect(matches(company(), 'gavort')).toBe(true)
    expect(matches(company(), 'lt1000')).toBe(true)
    expect(matches(company(), 'kaunas')).toBe(false)
    expect(matches(company(), '  ')).toBe(true)
  })

  it('says why the default and a company employing anyone stay', () => {
    expect(deleteRefusal(company({ is_default: true }))).toBeTruthy()
    expect(deleteRefusal(company({ employee_count: 3 }))).toBeTruthy()
    expect(deleteRefusal(company())).toBeUndefined()
  })
})
