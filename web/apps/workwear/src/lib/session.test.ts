import { describe, expect, it } from 'vitest'

import { REFRESH_WHEN_LEFT_MS, refreshDue, sessionFromToken } from './session'

/** An unsigned token with these claims: the app only reads them, the server verifies. */
function token(claims: object): string {
  const part = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.sig`
}

describe('refreshDue', () => {
  const now = Date.UTC(2026, 9, 2, 9, 0, 0)
  const expiringIn = (ms: number) => token({ sub: 'u1', roles: ['employee'], exp: (now + ms) / 1000 })

  it('leaves a fresh 15-minute token alone, and refreshes it once it is 5 minutes old', () => {
    expect(refreshDue(expiringIn(15 * 60_000), now)).toBe(false)
    expect(refreshDue(expiringIn(REFRESH_WHEN_LEFT_MS + 1000), now)).toBe(false)
    expect(refreshDue(expiringIn(REFRESH_WHEN_LEFT_MS - 1000), now)).toBe(true)
  })

  it('tries an expired token too: the server answers 401 and the app signs out', () => {
    expect(refreshDue(expiringIn(-60_000), now)).toBe(true)
  })

  it('ignores something that is not a token', () => {
    expect(refreshDue('not-a-token', now)).toBe(false)
  })
})

describe('sessionFromToken', () => {
  it('reads the user and roles, and refuses an expired token', () => {
    const exp = Date.now() / 1000 + 600
    expect(sessionFromToken(token({ sub: 'u1', roles: ['admin'], exp }), 'Ona')).toMatchObject({ userId: 'u1', name: 'Ona', isAdmin: true })
    expect(sessionFromToken(token({ sub: 'u1', roles: [], exp: Date.now() / 1000 - 1 }), 'Ona')).toBeNull()
  })
})
