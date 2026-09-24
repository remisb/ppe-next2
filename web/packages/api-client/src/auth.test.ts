import { describe, expect, it } from 'vitest'

import { decodeToken, hasAnyRole, isTokenExpired } from './auth.ts'

function token(payload: object): string {
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `x.${b64}.y`
}

describe('decodeToken', () => {
  it('reads sub, roles and exp', () => {
    expect(decodeToken(token({ sub: 'u1', roles: ['manager'], exp: 100 }))).toEqual({ sub: 'u1', roles: ['manager'], exp: 100 })
  })
  it('rejects malformed tokens', () => {
    expect(decodeToken('nope')).toBeNull()
    expect(decodeToken('a.!!!.c')).toBeNull()
    expect(decodeToken(token({ roles: [] }))).toBeNull()
  })
  it('checks expiry and roles', () => {
    const claims = { sub: 'u', roles: ['employee' as const], exp: 10 }
    expect(isTokenExpired(claims, 9_000)).toBe(false)
    expect(isTokenExpired(claims, 10_000)).toBe(true)
    expect(hasAnyRole(claims.roles, 'admin', 'manager')).toBe(false)
    expect(hasAnyRole(claims.roles, 'employee')).toBe(true)
  })
})
