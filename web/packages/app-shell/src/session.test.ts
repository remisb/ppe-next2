import { describe, expect, it } from 'vitest'

import { REFRESH_WHEN_LEFT_MS, canAdminister, refreshDue, sessionFromToken } from './session.ts'

/** An unsigned token with these claims: the app only reads them, the server verifies. */
function token(claims: object): string {
  const part = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.sig`
}

describe('refreshDue', () => {
  const now = Date.UTC(2026, 9, 2, 9, 0, 0)
  const expiringIn = (ms: number) => token({ sub: 'u1', perms: ['dashboard.employee'], exp: (now + ms) / 1000 })

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
  it('reads the user and permissions, and refuses an expired token', () => {
    const exp = Date.now() / 1000 + 600
    const s = sessionFromToken(token({ sub: 'u1', perms: ['users.manage', 'catalogue.manage'], exp }), 'Ona')
    expect(s).toMatchObject({ userId: 'u1', name: 'Ona' })
    expect(s?.can('catalogue.manage')).toBe(true)
    expect(s?.can('orders.delete')).toBe(false)
    expect(sessionFromToken(token({ sub: 'u1', perms: [], exp: Date.now() / 1000 - 1 }), 'Ona')).toBeNull()
  })
})

describe('canAdminister', () => {
  const reader = (...perms: string[]) => ({ can: (p: string) => perms.includes(p) })
  it('is any of the permissions that open a screen in Administration', () => {
    for (const p of ['users.manage', 'roles.manage', 'settings.manage', 'backups.read']) expect(canAdminister(reader(p))).toBe(true)
    expect(canAdminister(reader('users.read', 'catalogue.manage', 'dashboard.overview'))).toBe(false)
  })
})
