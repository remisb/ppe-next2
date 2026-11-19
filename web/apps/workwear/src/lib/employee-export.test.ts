import type { Employee } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { employeeExportColumns } from './employee-export'

const ruta: Employee = {
  id: 'e1',
  first_name: 'Rūta',
  last_name: 'Petrauskienė',
  full_name: 'Petrauskienė Rūta',
  code: 'E-022',
  height_cm: 168,
  clothing_size: 46,
  shoe_size: '38',
  notes: '',
  preferred_language: 'lt',
  default_photo_id: null,
  birth_date: '1990-04-02',
  nationality: 'LTU',
  sex: 'F',
  created_at: '2026-03-01T08:00:00Z',
  updated_at: '2026-03-01T08:00:00Z',
}

describe('employeeExportColumns', () => {
  it('offers every column to whoever sees sizes and profiles, the screen’s ticked', () => {
    const cols = employeeExportColumns({ sizes: true, profile: true })
    expect(cols.map((c) => c.key)).toEqual([
      'name',
      'first_name',
      'last_name',
      'code',
      'height',
      'clothing',
      'shoes',
      'language',
      'notes',
      'birth_date',
      'nationality',
      'sex',
      'added',
    ])
    expect(cols.filter((c) => c.shown).map((c) => c.key)).toEqual(['name', 'code', 'height', 'clothing', 'shoes'])
  })

  it('leaves out what the reader may not see', () => {
    expect(employeeExportColumns({ sizes: false, profile: false }).map((c) => c.key)).toEqual(['name', 'first_name', 'last_name', 'added'])
    expect(employeeExportColumns({ sizes: true, profile: false }).map((c) => c.key)).toEqual([
      'name',
      'first_name',
      'last_name',
      'height',
      'clothing',
      'shoes',
      'added',
    ])
  })

  it('gives numbers as numbers, the day added as a date, and an empty note as an empty cell', () => {
    const value = Object.fromEntries(employeeExportColumns({ sizes: true, profile: true }).map((c) => [c.key, c.value(ruta)]))
    expect(value).toMatchObject({ height: 168, clothing: 46, shoes: 38, notes: null, birth_date: '1990-04-02', sex: 'F', added: '2026-03-01' })
    expect(value.language).toBe('Lietuvių')
  })
})
