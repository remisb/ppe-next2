import type { Asset } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { assetQuery, checkSimDraft, formatDay, chooseTile, emptySimDraft, holderText, newSimInput, noAssetFilters, simDraftOf, tilePressed, todayIn } from './assets'

describe('tiles and filters', () => {
  it('a tile sets the place and keeps the status: In Office + Blocked (§3)', () => {
    const blocked = { ...noAssetFilters, status: 'BLOCKED' as const }
    const f = chooseTile(blocked, 'inOffice')
    expect(f).toMatchObject({ place: 'office', status: 'BLOCKED', notReturned: false })
    expect(tilePressed(f, 'inOffice')).toBe(true)
    expect(tilePressed(f, 'total')).toBe(false)
    expect(assetQuery(f, 'inventory', 'asc', 1)).toEqual({ kind: 'SIM', location: 'OFFICE', status: 'BLOCKED', sort: 'inventory', dir: 'asc', page: 1, page_size: 50 })
  })
  it('With Employees is everyone holding a card, whereabouts known or not', () => {
    expect(assetQuery(chooseTile(noAssetFilters, 'withEmployees'), 'holder', 'desc', 2)).toMatchObject({ held: true, sort: 'holder', dir: 'desc', page: 2 })
    expect(assetQuery(chooseTile(noAssetFilters, 'withEmployees'), 'inventory', 'asc', 1)).not.toHaveProperty('location')
  })
  it('Not Returned and Total', () => {
    const nr = chooseTile({ ...noAssetFilters, place: 'office' }, 'notReturned')
    expect(assetQuery(nr, 'inventory', 'asc', 1)).toMatchObject({ not_returned: true })
    expect(assetQuery(nr, 'inventory', 'asc', 1)).not.toHaveProperty('location')
    expect(tilePressed(chooseTile(nr, 'total'), 'total')).toBe(true)
  })
  it('leaves out what is not set, and trims the search', () => {
    expect(assetQuery({ ...noAssetFilters, q: '  612 40 ', provider: 'Telia', place: 'unknown' }, 'inventory', 'asc', 1)).toEqual({
      kind: 'SIM', q: '612 40', provider: 'Telia', location: 'UNKNOWN', sort: 'inventory', dir: 'asc', page: 1, page_size: 50,
    })
  })
})

const card = (over: Partial<Asset>): Asset => ({
  id: 'a', kind: 'SIM', category: null, inventory_no: 'SIM-000001', name: null, serial_no: null, sim_no: '0089370011', phone_no: null,
  provider: 'Telia', plan: null, non_return_value_cents: null, currency: 'EUR', connection_status: 'NOT_ACTIVATED', received_date: '2026-10-01',
  comment: '', created_at: '', updated_at: '', location: 'OFFICE', open_assignment: null, ...over,
})

describe('held by / location', () => {
  const open = { employee_name: 'Jonas Petraitis' } as Asset['open_assignment']
  it('names the Office, the holder, or Unknown with the last holder kept', () => {
    expect(holderText(card({}))).toEqual({ main: 'Office' })
    expect(holderText(card({ location: 'WITH_EMPLOYEE', open_assignment: open }))).toEqual({ main: 'Jonas Petraitis' })
    expect(holderText(card({ location: 'UNKNOWN', open_assignment: open }))).toEqual({ main: 'Unknown', sub: 'Last held by Jonas Petraitis' })
  })
})

describe('Add SIM Card', () => {
  it('needs the SIM No., provider, inventory number and received date now; the rest can wait (§4)', () => {
    const { errors, input } = checkSimDraft(emptySimDraft('2026-10-09'), '2026-10-09')
    expect(input).toBeUndefined()
    expect(Object.keys(errors).sort()).toEqual(['inventoryNo', 'provider', 'simNo'])
  })
  it('keeps the SIM number as typed, leading zeros included', () => {
    const d = { ...emptySimDraft('2026-10-09'), simNo: ' 0089 3700 ', provider: 'Telia', inventoryNo: 'SIM-000001', value: '25,00' }
    const { errors, input } = checkSimDraft(d, '2026-10-09')
    expect(errors).toEqual({})
    expect(input).toEqual({
      inventory_no: 'SIM-000001', sim_no: '0089 3700', phone_no: null, provider: 'Telia', plan: null,
      non_return_value_cents: 2500, received_date: '2026-10-09', comment: '',
    })
    expect(newSimInput(input!, 'ACTIVE')).toMatchObject({ kind: 'SIM', connection_status: 'ACTIVE' })
  })
  it('refuses what the API would', () => {
    const d = { ...emptySimDraft('2026-10-09'), simNo: '12-34', phoneNo: 'call me', provider: 'T', inventoryNo: 'X', value: 'abc', receivedDate: '2026-10-10' }
    expect(Object.keys(checkSimDraft(d, '2026-10-09').errors).sort()).toEqual(['phoneNo', 'receivedDate', 'simNo', 'value'])
  })
  it('Edit starts from the card', () => {
    const d = simDraftOf(card({ phone_no: '+370 612 40118', non_return_value_cents: 2500, connection_status: 'ACTIVE', comment: 'Spare' }))
    expect(d).toMatchObject({ simNo: '0089370011', phoneNo: '+370 612 40118', value: '25.00', status: 'ACTIVE', receivedDate: '2026-10-01', comment: 'Spare' })
  })
})

describe('today', () => {
  it('is the organisation’s calendar day', () => {
    expect(todayIn('Europe/Vilnius', new Date('2026-10-09T22:30:00Z'))).toBe('2026-10-10')
    expect(todayIn('UTC', new Date('2026-10-09T22:30:00Z'))).toBe('2026-10-09')
  })
})

describe('dates', () => {
  it('reads a calendar date without moving it to another day', () => {
    expect(formatDay('2026-03-02')).toMatch(/2 Mar 2026|Mar 2, 2026/)
  })
})
