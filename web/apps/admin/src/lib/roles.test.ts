import type { PermissionInfo } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { draftOf, grouped, neededBy, togglePermission, validateRole } from './roles'

// As GET /api/v1/permissions lists them (a part).
const catalogue: PermissionInfo[] = [
  { key: 'users.read', group: 'administration', requires: [] },
  { key: 'users.manage', group: 'administration', requires: ['users.read'] },
  { key: 'roles.manage', group: 'administration', requires: ['users.read'] },
  { key: 'catalogue.manage', group: 'workwear', requires: [] },
  { key: 'orders.delete', group: 'workwear', requires: [] },
  { key: 'dashboard.manager', group: 'dashboards', requires: [] },
]

describe('roles', () => {
  it('ticks what a permission needs with it, in the catalogue order', () => {
    expect(togglePermission(['orders.delete'], 'roles.manage', true, catalogue)).toEqual(['users.read', 'roles.manage', 'orders.delete'])
    expect(togglePermission(['users.read'], 'users.manage', true, catalogue)).toEqual(['users.read', 'users.manage'])
  })
  it('unticks what needs a permission with it', () => {
    expect(togglePermission(['users.read', 'users.manage', 'roles.manage', 'orders.delete'], 'users.read', false, catalogue)).toEqual(['orders.delete'])
    expect(togglePermission(['users.read', 'users.manage'], 'users.manage', false, catalogue)).toEqual(['users.read'])
  })
  it('says which ticked permissions keep one ticked', () => {
    expect(neededBy('users.read', ['users.read', 'users.manage', 'roles.manage'], catalogue)).toEqual(['users.manage', 'roles.manage'])
    expect(neededBy('users.read', ['users.read'], catalogue)).toEqual([])
  })
  it('groups the catalogue in its order', () => {
    expect(grouped(catalogue).map((g) => [g.group, g.permissions.length])).toEqual([
      ['administration', 3],
      ['workwear', 2],
      ['dashboards', 1],
    ])
  })
  it('requires a name of at most 100 characters', () => {
    expect(validateRole({ ...draftOf(undefined), name: ' ' }).name).toBeDefined()
    expect(validateRole({ ...draftOf(undefined), name: 'x'.repeat(101) }).name).toBeDefined()
    expect(validateRole({ ...draftOf(undefined), name: 'Storekeeper' })).toEqual({})
  })
})
