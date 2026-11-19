import type { ErrorEvent, LiveSession, Role, Supplier, User } from '@ppe/api-client'
import { tile } from '@ppe/launcher/testing'
import { describe, expect, it } from 'vitest'

import { appExportColumns, deviceExportColumns, errorExportColumns, roleExportColumns, supplierExportColumns, userExportColumns } from './list-export'
import { permissionLabel } from './roles'

/** A row as each column writes it, by the column's key. */
const cells = <T,>(columns: { key: string; value: (row: T) => unknown }[], row: T) => Object.fromEntries(columns.map((c) => [c.key, c.value(row)]))
const ticked = (columns: { key: string; shown?: boolean | undefined }[]) => columns.filter((c) => c.shown).map((c) => c.key)

const role = (id: string, key: Role['key'], name: string, permissions: Role['permissions'], users = 0): Role => ({
  id,
  key,
  name,
  description: key ? '' : `${name} things`,
  permissions,
  locked: key === 'admin',
  user_count: users,
  created_at: '',
  updated_at: '',
  created_by_user_id: null,
  updated_by_user_id: null,
})
const manager = role('r-manager', 'manager', 'Manager', ['users.read', 'orders.delete'], 3)
const people = role('r-people', null, 'People', ['users.manage'], 1)

describe('userExportColumns', () => {
  const ona: User = {
    id: 'u1',
    email: 'ona@example.com',
    name: 'Ona',
    role_ids: ['r-manager', 'r-people'],
    is_active: false,
    language: 'lt',
    created_at: '2026-03-01T22:30:00Z',
    updated_at: '2026-03-01T22:30:00Z',
  }

  it('ticks the list’s columns and writes roles, status, language and the day added in the organisation’s timezone', () => {
    const cols = userExportColumns([manager, people], 'Europe/Vilnius')
    expect(ticked(cols)).toEqual(['name', 'email', 'roles', 'status'])
    expect(cells(cols, ona)).toEqual({
      name: 'Ona',
      email: 'ona@example.com',
      roles: 'Manager, People',
      status: 'Inactive',
      language: 'Lietuvių',
      added: '2026-03-02',
    })
  })
})

describe('roleExportColumns', () => {
  it('names the built-ins, joins the permissions and counts the users', () => {
    const cols = roleExportColumns()
    expect(ticked(cols)).toEqual(['name', 'permissions', 'users'])
    expect(cells(cols, manager)).toMatchObject({ name: 'Manager', built_in: 'Built-in', description: null, users: 3 })
    expect(cells(cols, manager).permissions).toBe(['users.read', 'orders.delete'].map((p) => permissionLabel(p as Role['permissions'][number])).join(', '))
    expect(cells(cols, people)).toMatchObject({ built_in: null, description: 'People things' })
  })
})

describe('supplierExportColumns', () => {
  const acme: Supplier = {
    id: 's1',
    code: 'ACME',
    name: 'Acme UAB',
    company_code: '300000000',
    vat_code: 'LT100000000',
    address: 'Gedimino pr. 1',
    city: 'Vilnius',
    postal_code: 'LT-01103',
    country: 'LT',
    contact_person: 'Jonas',
    email: 'orders@acme.lt',
    phone: '',
    website: '',
    bank_account: 'LT12 1000 0111 0100 1000',
    notes: '',
    item_count: 4,
    created_at: '',
    updated_at: '',
  }

  it('offers every field of the record, an empty one as an empty cell', () => {
    const cols = supplierExportColumns()
    expect(cols.map((c) => c.key)).toEqual([
      'code',
      'name',
      'company_code',
      'vat_code',
      'address',
      'city',
      'postal_code',
      'country',
      'items',
      'contact_person',
      'email',
      'phone',
      'website',
      'bank_account',
      'notes',
    ])
    expect(cells(cols, acme)).toMatchObject({ code: 'ACME', items: 4, phone: null, bank_account: 'LT12 1000 0111 0100 1000', notes: null })
  })
})

describe('appExportColumns', () => {
  const launcher = tile('launcher', { names: { en: 'Apps', lt: 'Programėlės', ru: 'Приложения' } })
  const orders = tile('orders', { kind: 'shortcut', parent: 'launcher', names: { en: 'Orders', lt: 'Užsakymai', ru: 'Заказы' }, any_of: ['orders.delete'] })

  it('writes each tile’s place in the launcher, its app and who sees it', () => {
    const cols = appExportColumns([launcher, orders])
    expect(ticked(cols)).toEqual(['name', 'slug', 'kind', 'group', 'stage', 'tier'])
    expect(cells(cols, orders)).toMatchObject({ order: 2, name: 'Orders', kind: 'Shortcut', parent: 'Apps', audience: permissionLabel('orders.delete') })
    expect(cells(cols, launcher)).toMatchObject({ order: 1, parent: null, audience: 'Everyone signed in' })
  })
})

describe('deviceExportColumns', () => {
  const device: LiveSession = {
    id: 'd1',
    user_id: 'u1',
    user_name: 'Ona',
    user_email: 'ona@example.com',
    keep_signed_in: true,
    created_at: '2026-11-19T08:00:00Z',
    last_used_at: '2026-11-19T12:05:00Z',
    expires_at: '2026-12-19T12:05:00Z',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    ip: '192.0.2.10',
  }

  it('writes who, the device, the address and the moments in the organisation’s timezone', () => {
    const cols = deviceExportColumns('Europe/Vilnius')
    expect(ticked(cols)).toEqual(['user', 'email', 'device', 'address', 'last_used', 'signed_in'])
    expect(cells(cols, device)).toMatchObject({
      user: 'Ona',
      address: '192.0.2.10',
      sign_in: 'Kept signed in',
      last_used: '2026-11-19 14:05',
      signed_in: '2026-11-19 10:00',
      ends: '2026-12-19 14:05',
    })
    expect(cells(cols, device).device).toMatch(/Chrome/)
  })
})

describe('errorExportColumns', () => {
  const error: ErrorEvent = {
    id: 'e1',
    fingerprint: 'f',
    kind: 'server',
    route: 'GET /api/v1/orders/{id}',
    method: 'GET',
    status: 500,
    message: 'database is down',
    stack: '',
    source: null,
    first_seen: '2026-11-18T07:00:00Z',
    last_seen: '2026-11-19T07:00:00Z',
    count: 12,
    last_request_id: 'req-1',
    last_user_id: null,
    last_user_name: null,
    last_user_agent: null,
    app_version: null,
  }

  it('writes each error’s kind, count and moments, and where to look next', () => {
    const cols = errorExportColumns('Europe/Vilnius')
    expect(ticked(cols)).toEqual(['last_seen', 'error', 'route', 'kind', 'count'])
    expect(cells(cols, error)).toEqual({
      last_seen: '2026-11-19 09:00',
      error: 'database is down',
      route: 'GET /api/v1/orders/{id}',
      kind: 'Server error',
      count: 12,
      first_seen: '2026-11-18 09:00',
      status: 500,
      who: null,
      reference: 'req-1',
      app: null,
      app_version: null,
    })
  })
})
