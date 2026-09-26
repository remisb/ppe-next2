import { describe, expect, it } from 'vitest'

import { parsePath, pathOf, startRoute } from './router'

describe('router', () => {
  it('round-trips every route', () => {
    for (const name of [
      'home',
      'dashboard',
      'managerDashboard',
      'createOrder',
      'employees',
      'catalogue',
      'itemSets',
      'users',
      'history',
      'account',
    ] as const) {
      expect(parsePath(pathOf({ name }))).toEqual({ name })
    }
    expect(parsePath(pathOf({ name: 'employee', id: 'a/b' }))).toEqual({ name: 'employee', id: 'a/b' })
    expect(parsePath(pathOf({ name: 'record', id: 'a b' }))).toEqual({ name: 'record', id: 'a b' })
    expect(parsePath(pathOf({ name: 'confirm', token: 'Ab-_9' }))).toEqual({ name: 'confirm', token: 'Ab-_9' })
  })
  it('sends unknown paths and the root to the start screen', () => {
    expect(parsePath('/')).toEqual({ name: 'home' })
    expect(parsePath('/nope')).toEqual({ name: 'home' })
    expect(parsePath('/employees/')).toEqual({ name: 'employees' })
    expect(parsePath('/confirm/')).toEqual({ name: 'home' })
  })
  it('starts each role on its own dashboard, and keeps each dashboard to its role', () => {
    const admin = { isAdmin: true, isManager: false }
    const manager = { isAdmin: false, isManager: true }
    const both = { isAdmin: true, isManager: true }
    const employee = { isAdmin: false, isManager: false }
    expect(startRoute({ name: 'home' }, admin)).toEqual({ name: 'dashboard' })
    expect(startRoute({ name: 'home' }, manager)).toEqual({ name: 'managerDashboard' })
    expect(startRoute({ name: 'home' }, both)).toEqual({ name: 'dashboard' })
    expect(startRoute({ name: 'home' }, employee)).toEqual({ name: 'createOrder' })

    expect(startRoute({ name: 'dashboard' }, manager)).toEqual({ name: 'managerDashboard' })
    expect(startRoute({ name: 'dashboard' }, employee)).toEqual({ name: 'createOrder' })
    expect(startRoute({ name: 'managerDashboard' }, admin)).toEqual({ name: 'dashboard' })
    expect(startRoute({ name: 'managerDashboard' }, employee)).toEqual({ name: 'createOrder' })
    expect(startRoute({ name: 'managerDashboard' }, both)).toEqual({ name: 'managerDashboard' })
    expect(startRoute({ name: 'history' }, employee)).toEqual({ name: 'history' })
  })
})
