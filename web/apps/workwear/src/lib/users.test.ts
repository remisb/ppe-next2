import type { User } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { draftOf, ownAccountLocks, sortRoles, validateNewPassword, validateUser } from './users'

const user: User = {
  id: 'u1',
  email: 'ona@example.com',
  name: 'Ona',
  roles: ['employee', 'admin'],
  is_active: true,
  created_at: '',
  updated_at: '',
}

describe('users', () => {
  it('starts a new user as an active employee', () => {
    expect(draftOf(undefined)).toMatchObject({ roles: ['employee'], isActive: true, password: '' })
  })
  it('orders roles highest first', () => {
    expect(draftOf(user).roles).toEqual(['admin', 'employee'])
    expect(sortRoles(['employee', 'manager'])).toEqual(['manager', 'employee'])
  })
  it('requires name, a bare email and a role', () => {
    const d = { ...draftOf(undefined), password: 'long-enough', confirm: 'long-enough' }
    expect(validateUser({ ...d, name: ' ', email: 'x@y.lt' }, true).name).toBeDefined()
    expect(validateUser({ ...d, name: 'A', email: 'Ona <o@x.lt>' }, true).email).toBeDefined()
    expect(validateUser({ ...d, name: 'A', email: 'no-at-sign' }, true).email).toBeDefined()
    expect(validateUser({ ...d, name: 'A', email: 'o@x.lt', roles: [] }, true).roles).toBeDefined()
    expect(validateUser({ ...d, name: 'A', email: 'o@x.lt' }, true)).toEqual({})
  })
  it('asks for a password only for a new user', () => {
    const d = { ...draftOf(user) }
    expect(validateUser(d, false)).toEqual({})
    expect(validateUser(d, true).password).toMatch(/at least 8/)
  })
  it('checks a set password and its confirmation', () => {
    expect(validateNewPassword('short', 'short').password).toMatch(/at least 8/)
    expect(validateNewPassword('long-enough', 'different').confirm).toMatch(/do not match/)
    expect(validateNewPassword('long-enough', 'long-enough')).toEqual({})
  })
  it('locks deactivation and the admin role on the own account only', () => {
    expect(ownAccountLocks(user, 'u1')).toEqual({ active: true, admin: true })
    expect(ownAccountLocks(user, 'someone-else')).toEqual({ active: false, admin: false })
    expect(ownAccountLocks({ ...user, roles: ['manager'] }, 'u1')).toEqual({ active: true, admin: false })
    expect(ownAccountLocks(undefined, 'u1')).toEqual({ active: false, admin: false })
  })
})
