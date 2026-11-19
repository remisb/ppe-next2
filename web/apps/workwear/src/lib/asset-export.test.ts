import type { Asset, AssetAssignment, AssetPage, AssetQuery } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { equipmentExportColumns, loadAllAssets, simExportColumns } from './asset-export'

const assignment = (over: Partial<AssetAssignment> = {}): AssetAssignment => ({
  id: 'as1',
  asset_id: 'a1',
  employee_id: 'e1',
  employee_name: 'Ona Kazlauskienė',
  given_date: '2026-10-02',
  given_by_user_id: 'u1',
  created_at: '2026-10-02T08:00:00Z',
  comment: '',
  form: null,
  form_template_version: null,
  document_hash: null,
  paper_form_signed: true,
  not_returned_at: null,
  not_returned_by_user_id: null,
  not_returned_comment: null,
  whereabouts: null,
  returned_date: null,
  returned_at: null,
  returned_by_user_id: null,
  return_comment: null,
  days_held: 48,
  signed_copy_uploaded: false,
  ...over,
})

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: 'a1',
  kind: 'SIM',
  category: null,
  inventory_no: 'SIM-0001',
  name: null,
  serial_no: null,
  sim_no: '8937001000000000015',
  phone_no: '+370 600 00001',
  provider: 'Telia',
  plan: 'Business 10 GB',
  non_return_value_cents: 2500,
  currency: 'EUR',
  connection_status: 'ACTIVE',
  received_date: '2026-09-01',
  comment: '',
  created_at: '2026-09-01T08:00:00Z',
  updated_at: '2026-09-01T08:00:00Z',
  location: 'WITH_EMPLOYEE',
  open_assignment: assignment(),
  needs_form: true,
  has_sim_codes: true,
  ...over,
})

const values = (cols: ReturnType<typeof simExportColumns>, a: Asset) => Object.fromEntries(cols.map((c) => [c.key, c.value(a)]))

describe('simExportColumns', () => {
  it('starts with the register’s columns ticked, and never offers PIN or PUK', () => {
    const cols = simExportColumns()
    expect(cols.filter((c) => c.shown).map((c) => c.key)).toEqual(['phone', 'sim', 'employee', 'provider', 'plan', 'status', 'given', 'documents', 'comment'])
    expect(cols.map((c) => c.key).join(' ')).not.toMatch(/pin|puk|code/i)
  })

  it('gives a card’s numbers, holder, status and documents as the register words them', () => {
    expect(values(simExportColumns(), asset())).toMatchObject({
      inventory: 'SIM-0001',
      phone: '+370 600 00001',
      sim: '8937001000000000015',
      employee: 'Ona Kazlauskienė',
      location: 'With Employee',
      status: 'Active',
      given: '2026-10-02',
      documents: 'Signed Copy Missing',
      not_returned: null,
      value: 25,
      comment: null,
    })
  })

  it('writes the Not Returned day in the organisation’s timezone, and an office card without a holder', () => {
    const lost = asset({ location: 'UNKNOWN', open_assignment: assignment({ not_returned_at: '2026-11-18T22:30:00Z' }) })
    expect(values(simExportColumns('Europe/Vilnius'), lost)).toMatchObject({ location: 'Unknown', employee: 'Ona Kazlauskienė', not_returned: '2026-11-19' })
    expect(values(simExportColumns(), asset({ location: 'OFFICE', open_assignment: null }))).toMatchObject({ employee: null, location: 'Office', given: null, documents: null })
  })
})

describe('equipmentExportColumns', () => {
  it('names the item, its category and serial number', () => {
    const laptop = asset({ kind: 'EQUIPMENT', inventory_no: 'INV-0042', name: 'ThinkPad T14', category: 'COMPUTER', serial_no: 'PF-123', sim_no: null, phone_no: null })
    const cols = equipmentExportColumns()
    expect(cols.filter((c) => c.shown).map((c) => c.key)).toEqual(['inventory', 'name', 'category', 'serial', 'employee', 'location', 'given', 'documents', 'comment'])
    expect(values(cols, laptop)).toMatchObject({ inventory: 'INV-0042', name: 'ThinkPad T14', serial: 'PF-123', employee: 'Ona Kazlauskienė' })
    expect(values(cols, laptop).category).toBeTruthy()
  })
})

describe('loadAllAssets', () => {
  it('fetches every page of the register’s query, in order', async () => {
    const all = Array.from({ length: 5 }, (_, i) => asset({ id: `a${i}` }))
    const asked: AssetQuery[] = []
    const list = async (q: AssetQuery): Promise<AssetPage> => {
      asked.push(q)
      const page = q.page ?? 1
      const size = q.page_size ?? 50
      return { assets: all.slice((page - 1) * size, page * size), page, page_size: size, total: all.length }
    }
    const got = await loadAllAssets(list, { kind: 'SIM', status: 'ACTIVE', sort: 'phone', dir: 'asc', page: 3, page_size: 50 }, 2)
    expect(got.map((a) => a.id)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4'])
    expect(asked.map((q) => [q.page, q.page_size, q.status, q.sort])).toEqual([
      [1, 2, 'ACTIVE', 'phone'],
      [2, 2, 'ACTIVE', 'phone'],
      [3, 2, 'ACTIVE', 'phone'],
    ])
  })
})
