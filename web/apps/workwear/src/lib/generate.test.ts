import type { AskedField, Employment } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { defaultEmployment, generateInput, inputProblems, pdfBlob, samePreview } from './generate'

const job = (id: string, started: string | null, ended: string | null): Employment => ({
  id,
  employee_id: 'e1',
  company_id: 'c1',
  company_name: 'UAB',
  started_on: started,
  ended_on: ended,
  created_at: '',
  updated_at: '',
})

describe('Generate Document…', () => {
  it('starts with the open employment, else the latest, none for a candidate', () => {
    expect(defaultEmployment([job('a', '2020-01-01', '2021-01-01'), job('b', '2022-01-01', null)])).toBe('b')
    expect(defaultEmployment([job('a', '2020-01-01', '2021-01-01'), job('c', '2023-01-01', '2024-01-01')])).toBe('c')
    expect(defaultEmployment([])).toBeNull()
    expect(defaultEmployment(undefined)).toBeNull()
  })
  const asked: AskedField[] = [
    { key: 'salary', label: 'Salary', kind: 'money', required: true },
    { key: 'shift', label: 'Shift', kind: 'choice', required: false, options: ['Day', 'Night'] },
    { key: 'note', label: 'Note', kind: 'text', required: false },
  ]
  it('needs the required answers, a number where one is asked, and a choice among its options', () => {
    expect(inputProblems(asked, {})).toEqual({ salary: 'Fill this in.' })
    expect(inputProblems(asked, { salary: '2 400,50 €', shift: 'Night' })).toEqual({})
    expect(Object.keys(inputProblems(asked, { salary: 'lots', shift: 'Evening' })).sort()).toEqual(['salary', 'shift'])
  })
  it('sends only the asked answers, and Generate needs the same as previewed', () => {
    const a = generateInput('t1', 'e1', 'j1', asked, { salary: ' 2400 ', note: '', other: 'x' })
    expect(a).toEqual({ template_id: 't1', employee_id: 'e1', employment_id: 'j1', inputs: { salary: '2400' } })
    expect(samePreview(a, generateInput('t1', 'e1', 'j1', asked, { salary: '2400' }))).toBe(true)
    expect(samePreview(a, generateInput('t1', 'e1', 'j1', asked, { salary: '2500' }))).toBe(false)
    expect(samePreview(null, a)).toBe(false)
  })
  it('reads a base64 PDF', async () => {
    const blob = pdfBlob(btoa('%PDF-1.7'))
    expect(blob.type).toBe('application/pdf')
    expect(await blob.text()).toBe('%PDF-1.7')
  })
})
