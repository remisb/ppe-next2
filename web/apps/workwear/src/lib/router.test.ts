import { describe, expect, it } from 'vitest'

import { parsePath, pathOf } from './router'

describe('router', () => {
  it('round-trips every route', () => {
    for (const name of ['createOrder', 'employees', 'catalogue', 'itemSets', 'users', 'history', 'account'] as const) {
      expect(parsePath(pathOf({ name }))).toEqual({ name })
    }
    expect(parsePath(pathOf({ name: 'employee', id: 'a/b' }))).toEqual({ name: 'employee', id: 'a/b' })
    expect(parsePath(pathOf({ name: 'record', id: 'a b' }))).toEqual({ name: 'record', id: 'a b' })
    expect(parsePath(pathOf({ name: 'confirm', token: 'Ab-_9' }))).toEqual({ name: 'confirm', token: 'Ab-_9' })
  })
  it('sends unknown paths and the root to Create Order', () => {
    expect(parsePath('/')).toEqual({ name: 'createOrder' })
    expect(parsePath('/nope')).toEqual({ name: 'createOrder' })
    expect(parsePath('/employees/')).toEqual({ name: 'employees' })
    expect(parsePath('/confirm/')).toEqual({ name: 'createOrder' })
  })
})
