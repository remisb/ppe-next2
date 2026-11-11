import type { Employee } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { joinedNotes, mergeDefaults, mergedInput, olderOf } from './merge-employees'

const employee = (over: Partial<Employee>): Employee => ({
  id: 'x',
  first_name: 'A',
  last_name: 'B',
  full_name: 'A B',
  code: null,
  height_cm: null,
  clothing_size: null,
  shoe_size: null,
  notes: '',
  preferred_language: null,
  default_photo_id: null,
  birth_date: null,
  nationality: null,
  sex: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
})

// The pair found on production.
const older = employee({ id: 'older', first_name: 'Abhijith', last_name: 'Palanil Sajeevan', height_cm: 160, clothing_size: 52, shoe_size: '42', notes: 'Night shift', created_at: '2026-03-01T00:00:00Z' })
const newer = employee({ id: 'newer', first_name: 'PALANJIL', last_name: 'SAJEEVAN ABHIJITH', code: '192', height_cm: 173, clothing_size: 52, shoe_size: '42', created_at: '2026-06-01T00:00:00Z' })

describe('Merge Employees', () => {
  it('keeps the older record unless chosen otherwise', () => {
    expect(olderOf(newer, older)).toBe(older)
    expect(olderOf(older, newer)).toBe(older)
  })

  it('takes the kept record’s values, and the other’s where it has none', () => {
    const c = mergeDefaults(older, newer)
    expect(c).toMatchObject({ name: 'older', code: 'newer', height_cm: 'older', preferred_language: 'older' })
    expect(mergedInput(older, newer, c)).toEqual({
      first_name: 'Abhijith',
      last_name: 'Palanil Sajeevan',
      code: '192',
      height_cm: 160,
      clothing_size: 52,
      shoe_size: '42',
      notes: 'Night shift',
      preferred_language: null,
    })
  })

  it('takes each row’s chosen value', () => {
    const c = { ...mergeDefaults(older, newer), height_cm: 'newer', name: 'newer' }
    expect(mergedInput(older, newer, c)).toMatchObject({ first_name: 'PALANJIL', last_name: 'SAJEEVAN ABHIJITH', height_cm: 173 })
  })

  it('keeps both notes, once each', () => {
    expect(joinedNotes(older, newer)).toBe('Night shift')
    expect(joinedNotes(older, { ...newer, notes: 'Night shift' })).toBe('Night shift')
    expect(joinedNotes(older, { ...newer, notes: 'Left-handed' })).toBe('Night shift\nLeft-handed')
    expect(joinedNotes({ ...older, notes: '' }, { ...newer, notes: 'Left-handed' })).toBe('Left-handed')
  })
})
