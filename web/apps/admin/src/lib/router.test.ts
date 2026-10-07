import { describe, expect, it } from 'vitest'

import { parsePath, pathOf, startRoute } from './router'

describe('router', () => {
  it('round-trips every route', () => {
    for (const name of ['home', 'users', 'roles', 'settings', 'backups'] as const) expect(parsePath(pathOf({ name }))).toEqual({ name })
    expect(parsePath(pathOf({ name: 'audit', filter: {} }))).toEqual({ name: 'audit', filter: {} })
    expect(parsePath('/users/')).toEqual({ name: 'users' })
    expect(parsePath('/nope')).toEqual({ name: 'home' })
  })

  it('keeps the Audit log\'s filters and open change in its address', () => {
    expect(parsePath('/audit')).toEqual({ name: 'audit', filter: {} })
    const route = { name: 'audit', filter: { area: 'catalogue', from: '2026-10-01', entity_type: 'user', entity_id: 'u1' }, event: 'e1' } as const
    expect(pathOf(route)).toBe('/audit/e1?area=catalogue&entity_type=user&entity_id=u1&from=2026-10-01')
    expect(parsePath('/audit/e1', '?area=catalogue&entity_type=user&entity_id=u1&from=2026-10-01')).toEqual(route)
    // Unknown and empty parameters are dropped.
    expect(parsePath('/audit', '?area=&colour=blue&event=order.given')).toEqual({ name: 'audit', filter: { event: 'order.given' } })
  })

  it('keeps the Security tab, and the sign-ins\' filters, in its address', () => {
    expect(parsePath('/security')).toEqual({ name: 'security', tab: 'sign-ins', filter: {} })
    for (const tab of ['devices', 'review'] as const) {
      expect(pathOf({ name: 'security', tab, filter: {} })).toBe(`/security/${tab}`)
      expect(parsePath(`/security/${tab}`, '?kind=sign_in')).toEqual({ name: 'security', tab, filter: {} })
    }
    const route = { name: 'security', tab: 'sign-ins', filter: { kind: 'sign_in_failed', user: 'u1', from: '2026-10-01' } } as const
    expect(pathOf(route)).toBe('/security?kind=sign_in_failed&user=u1&from=2026-10-01')
    expect(parsePath('/security', '?kind=sign_in_failed&user=u1&from=2026-10-01&colour=blue')).toEqual(route)
    expect(parsePath('/security/other')).toEqual({ name: 'home' })
  })

  it('opens the first screen the user may open, and only screens they may', () => {
    const holding = (...perms: string[]) => (p: string) => perms.includes(p)
    const admin = holding('users.read', 'users.manage', 'roles.manage', 'settings.manage', 'backups.read')
    const backupsOnly = holding('backups.read')
    expect(startRoute({ name: 'home' }, admin)).toEqual({ name: 'users' })
    expect(startRoute({ name: 'backups' }, admin)).toEqual({ name: 'backups' })
    expect(startRoute({ name: 'roles' }, admin)).toEqual({ name: 'roles' })
    expect(startRoute({ name: 'roles' }, holding('users.manage'))).toEqual({ name: 'users' })
    expect(startRoute({ name: 'home' }, backupsOnly)).toEqual({ name: 'backups' })
    expect(startRoute({ name: 'users' }, backupsOnly)).toEqual({ name: 'backups' })
    expect(startRoute({ name: 'home' }, holding('audit.read'))).toEqual({ name: 'audit', filter: {} })
    expect(startRoute({ name: 'home' }, holding('security.read'))).toEqual({ name: 'security', tab: 'sign-ins', filter: {} })
    expect(startRoute({ name: 'security', tab: 'review', filter: {} }, admin)).toEqual({ name: 'users' })
    expect(startRoute({ name: 'audit', filter: {} }, admin)).toEqual({ name: 'users' })
    // users.read alone (a manager) opens nothing here.
    expect(startRoute({ name: 'home' }, holding('users.read', 'catalogue.manage'))).toBeNull()
  })
})
