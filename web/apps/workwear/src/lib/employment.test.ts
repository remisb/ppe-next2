import type { Employment } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { checkEnd, checkPeriod, countByStatus, defaultCompanyId, openEmployment, overlaps, periodText } from './employment'

const job = (over: Partial<Employment>): Employment => ({
  id: 'm1',
  employee_id: 'e1',
  company_id: 'a',
  company_name: 'UAB A',
  started_on: '2026-01-10',
  ended_on: null,
  created_at: '',
  updated_at: '',
  ...over,
})

describe('the list', () => {
  it('counts each status', () => {
    expect(countByStatus([{ status: 'employee' }, { status: 'employee' }, { status: 'former' }])).toEqual({ employee: 2, candidate: 0, former: 1 })
  })

  it('chooses the default company, or the only one', () => {
    expect(defaultCompanyId([{ id: 'a', is_default: false }, { id: 'b', is_default: true }])).toBe('b')
    expect(defaultCompanyId([{ id: 'a', is_default: false }])).toBe('a')
    expect(defaultCompanyId([{ id: 'a', is_default: false }, { id: 'b', is_default: false }])).toBe('')
    expect(defaultCompanyId([])).toBe('')
  })
})

describe('periods', () => {
  it('reads a period', () => {
    expect(periodText(job({}))).toMatch(/2026/)
    expect(periodText(job({ started_on: null }))).not.toMatch(/2026/)
    expect(periodText(job({ ended_on: '2026-03-01' }))).toMatch(/–/)
  })

  it('lets the next start on the day the last ended', () => {
    expect(overlaps({ started_on: '2026-01-01', ended_on: '2026-02-01' }, { started_on: '2026-02-01', ended_on: null })).toBe(false)
    expect(overlaps({ started_on: '2026-01-01', ended_on: '2026-02-02' }, { started_on: '2026-02-01', ended_on: null })).toBe(true)
    expect(overlaps({ started_on: null, ended_on: null }, { started_on: '2030-01-01', ended_on: null })).toBe(true)
  })

  it('finds the open one', () => {
    expect(openEmployment([job({ id: 'x', ended_on: '2025-01-01' }), job({ id: 'y' })])?.id).toBe('y')
    expect(openEmployment([job({ ended_on: '2025-01-01' })])).toBeUndefined()
  })
})

describe('checkPeriod', () => {
  const draft = { companyId: 'b', startedOn: '2026-05-01', endedOn: '' }

  it('needs a company', () => {
    expect(checkPeriod({ ...draft, companyId: '' }, [])).toHaveProperty('companyId')
    expect(checkPeriod(draft, [])).toEqual({})
  })

  it('refuses Employ while employed, and an overlap', () => {
    expect(checkPeriod(draft, [job({})])).toHaveProperty('companyId')
    expect(checkPeriod(draft, [job({ ended_on: '2026-06-01' })])).toHaveProperty('startedOn')
    expect(checkPeriod(draft, [job({ ended_on: '2026-05-01' })])).toEqual({})
  })

  it('moves from the open period on a day no earlier than its start, to another company', () => {
    expect(checkPeriod(draft, [job({})], { move: true })).toEqual({})
    expect(checkPeriod({ ...draft, startedOn: '' }, [job({})], { move: true })).toHaveProperty('startedOn')
    expect(checkPeriod({ ...draft, startedOn: '2025-12-31' }, [job({})], { move: true })).toHaveProperty('startedOn')
    expect(checkPeriod({ ...draft, companyId: 'a' }, [job({})], { move: true })).toHaveProperty('companyId')
  })

  it('edits a period: in order, not open beside another open one', () => {
    const m = job({ ended_on: '2026-03-01' })
    expect(checkPeriod({ companyId: 'a', startedOn: '2026-01-10', endedOn: '2026-02-01' }, [m], { editing: m })).toEqual({})
    expect(checkPeriod({ companyId: 'a', startedOn: '2026-03-10', endedOn: '2026-02-01' }, [m], { editing: m })).toHaveProperty('endedOn')
    expect(checkPeriod({ companyId: 'a', startedOn: '2026-01-10', endedOn: '' }, [m, job({ id: 'm2', started_on: '2026-04-01' })], { editing: m })).toHaveProperty('endedOn')
  })
})

describe('checkEnd', () => {
  it('needs a day no earlier than the start', () => {
    expect(checkEnd('', job({}))).toBeTruthy()
    expect(checkEnd('2026-01-01', job({}))).toBeTruthy()
    expect(checkEnd('2026-01-10', job({}))).toBeUndefined()
    expect(checkEnd('2020-01-01', job({ started_on: null }))).toBeUndefined()
  })
})
