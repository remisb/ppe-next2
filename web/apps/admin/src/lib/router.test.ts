import { describe, expect, it } from 'vitest'

import { parsePath, pathOf, startRoute } from './router'

describe('router', () => {
  it('round-trips every route', () => {
    for (const name of ['home', 'users', 'roles', 'settings', 'backups'] as const) expect(parsePath(pathOf({ name }))).toEqual({ name })
    expect(parsePath('/users/')).toEqual({ name: 'users' })
    expect(parsePath('/nope')).toEqual({ name: 'home' })
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
    // users.read alone (a manager) opens nothing here.
    expect(startRoute({ name: 'home' }, holding('users.read', 'catalogue.manage'))).toBeNull()
  })
})
