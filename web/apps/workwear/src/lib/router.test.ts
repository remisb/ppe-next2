import { describe, expect, it } from 'vitest'

import { parsePath, pathOf, startRoute } from './router'

describe('router', () => {
  it('round-trips every route', () => {
    for (const name of ['home', 'dashboard', 'createOrder', 'employees', 'catalogue', 'itemSets', 'users', 'history', 'account'] as const) {
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
  it('starts administrators on the Dashboard and everyone else on Create Order', () => {
    expect(startRoute({ name: 'home' }, true)).toEqual({ name: 'dashboard' })
    expect(startRoute({ name: 'home' }, false)).toEqual({ name: 'createOrder' })
    expect(startRoute({ name: 'dashboard' }, false)).toEqual({ name: 'createOrder' })
    expect(startRoute({ name: 'dashboard' }, true)).toEqual({ name: 'dashboard' })
    expect(startRoute({ name: 'history' }, false)).toEqual({ name: 'history' })
  })
})
