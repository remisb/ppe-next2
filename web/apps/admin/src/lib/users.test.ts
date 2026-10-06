import type { Role, User } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { draftOf, ownAccountLocks, roleName, roleRank, rolesOf, validateNewPassword, validateUser } from './users'

const role = (id: string, key: Role['key'], name: string, permissions: Role['permissions']): Role => ({
  id,
  key,
  name,
  description: `${name} things`,
  permissions,
  locked: key === 'admin',
  user_count: 0,
  created_at: '',
  updated_at: '',
  created_by_user_id: null,
  updated_by_user_id: null,
})

// As GET /api/v1/roles lists them: the built-ins first, then by name.
const admin = role('r-admin', 'admin', 'Administrator', ['users.read', 'users.manage', 'roles.manage', 'settings.manage'])
const manager = role('r-manager', 'manager', 'Manager', ['users.read', 'orders.delete'])
const employee = role('r-employee', 'employee', 'Employee', ['dashboard.employee'])
const people = role('r-people', null, 'People', ['users.read', 'users.manage'])
const all = [admin, manager, employee, people]

const user: User = {
  id: 'u1',
  email: 'ona@example.com',
  name: 'Ona',
  role_ids: ['r-employee', 'r-admin'],
  is_active: true,
  language: 'en',
  created_at: '',
  updated_at: '',
}

describe('users', () => {
  it('starts a new user as an active employee', () => {
    expect(draftOf(undefined, all)).toMatchObject({ roleIds: ['r-employee'], isActive: true, password: '' })
  })
  it('names built-in roles in the language in use and the others by their own name, highest first', () => {
    expect(rolesOf(user.role_ids, all).map(roleName)).toEqual(['Administrator', 'Employee'])
    expect(roleName(people)).toBe('People')
    expect(draftOf(user, all).roleIds).toEqual(['r-admin', 'r-employee'])
    expect(roleRank(user, all)).toBe(0)
    expect(roleRank({ ...user, role_ids: ['r-people'] }, all)).toBe(3)
  })
  it('requires name, a bare email and a role', () => {
    const d = { ...draftOf(undefined, all), password: 'long-enough', confirm: 'long-enough' }
    expect(validateUser({ ...d, name: ' ', email: 'x@y.lt' }, true).name).toBeDefined()
    expect(validateUser({ ...d, name: 'A', email: 'Ona <o@x.lt>' }, true).email).toBeDefined()
    expect(validateUser({ ...d, name: 'A', email: 'no-at-sign' }, true).email).toBeDefined()
    expect(validateUser({ ...d, name: 'A', email: 'o@x.lt', roleIds: [] }, true).roles).toBeDefined()
    expect(validateUser({ ...d, name: 'A', email: 'o@x.lt' }, true)).toEqual({})
  })
  it('asks for a password only for a new user', () => {
    const d = { ...draftOf(user, all) }
    expect(validateUser(d, false)).toEqual({})
    expect(validateUser(d, true).password).toMatch(/at least 8/)
  })
  it('checks a set password and its confirmation', () => {
    expect(validateNewPassword('short', 'short').password).toMatch(/at least 8/)
    expect(validateNewPassword('long-enough', 'different').confirm).toMatch(/do not match/)
    expect(validateNewPassword('long-enough', 'long-enough')).toEqual({})
  })
  it('locks deactivation, and a role that alone gives managing users or roles, on the own account only', () => {
    expect(ownAccountLocks(user, 'u1', all)).toEqual({ active: true, roleIds: ['r-admin'] })
    expect(ownAccountLocks(user, 'someone-else', all)).toEqual({ active: false, roleIds: [] })
    expect(ownAccountLocks({ ...user, role_ids: ['r-manager'] }, 'u1', all)).toEqual({ active: true, roleIds: [] })
    // People also manages users, but only Administrator manages roles: it stays locked; People does not.
    expect(ownAccountLocks({ ...user, role_ids: ['r-admin', 'r-people'] }, 'u1', all)).toEqual({ active: true, roleIds: ['r-admin'] })
    expect(ownAccountLocks({ ...user, role_ids: ['r-people'] }, 'u1', all)).toEqual({ active: true, roleIds: ['r-people'] })
    expect(ownAccountLocks(undefined, 'u1', all)).toEqual({ active: false, roleIds: [] })
  })
})
