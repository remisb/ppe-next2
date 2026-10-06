import { describe, expect, it } from 'vitest'

import { decodeToken, isTokenExpired } from './auth.ts'

function token(payload: object): string {
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `x.${b64}.y`
}

describe('decodeToken', () => {
  it('reads sub, perms and exp, dropping permissions it does not know', () => {
    expect(decodeToken(token({ sub: 'u1', perms: ['orders.delete', 'everything'], roles: ['manager'], exp: 100 }))).toEqual({
      sub: 'u1',
      perms: ['orders.delete'],
      exp: 100,
    })
    expect(decodeToken(token({ sub: 'u1', exp: 100 }))).toEqual({ sub: 'u1', perms: [], exp: 100 })
  })
  it('rejects malformed tokens', () => {
    expect(decodeToken('nope')).toBeNull()
    expect(decodeToken('a.!!!.c')).toBeNull()
    expect(decodeToken(token({ perms: [] }))).toBeNull()
  })
  it('checks expiry', () => {
    const claims = { sub: 'u', perms: [], exp: 10 }
    expect(isTokenExpired(claims, 9_000)).toBe(false)
    expect(isTokenExpired(claims, 10_000)).toBe(true)
  })
})
