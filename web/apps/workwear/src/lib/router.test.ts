import { describe, expect, it } from 'vitest'

import { parsePath, pathOf, startRoute } from './router'

describe('router', () => {
  it('round-trips every route', () => {
    for (const name of [
      'home',
      'dashboard',
      'managerDashboard',
      'employeeDashboard',
      'createOrder',
      'employees',
      'catalogue',
      'itemSets',
      'users',
      'history',
      'account',
      'replacements',
    ] as const) {
      expect(parsePath(pathOf({ name }))).toEqual({ name })
    }
    expect(parsePath(pathOf({ name: 'employee', id: 'a/b' }))).toEqual({ name: 'employee', id: 'a/b' })
    expect(parsePath(pathOf({ name: 'catalogueItem', id: 'x/y' }))).toEqual({ name: 'catalogueItem', id: 'x/y' })
    expect(parsePath(pathOf({ name: 'record', id: 'a b' }))).toEqual({ name: 'record', id: 'a b' })
    expect(parsePath(pathOf({ name: 'confirm', token: 'Ab-_9' }))).toEqual({ name: 'confirm', token: 'Ab-_9' })
    expect(parsePath(pathOf({ name: 'history', order: 'o 1' }))).toEqual({ name: 'history', order: 'o 1' })
  })
  it('keeps the old History addresses, and tells an order from a new one and a record', () => {
    expect(pathOf({ name: 'history' })).toBe('/orders')
    expect(pathOf({ name: 'history', order: 'o1' })).toBe('/orders/o1')
    expect(parsePath('/history')).toEqual({ name: 'history' })
    expect(parsePath('/history', '?status=GIVEN')).toEqual({ name: 'history', status: 'GIVEN' })
    expect(parsePath('/history/o1')).toEqual({ name: 'history', order: 'o1' })
    expect(parsePath('/orders/new')).toEqual({ name: 'createOrder' })
    expect(parsePath('/orders/o1/record')).toEqual({ name: 'record', id: 'o1' })
  })
  it('opens Orders on a status tab and Employees on the missing-size filter', () => {
    expect(pathOf({ name: 'history', status: 'ORDERED' })).toBe('/orders?status=ORDERED')
    expect(parsePath('/orders', '?status=ORDERED')).toEqual({ name: 'history', status: 'ORDERED' })
    expect(parsePath('/orders', '?status=DRAFT')).toEqual({ name: 'history' })
    expect(pathOf({ name: 'employees', missing: true })).toBe('/employees?missing=1')
    expect(parsePath('/employees', '?missing=1')).toEqual({ name: 'employees', missing: true })
    expect(parsePath('/employees', '?missing=yes')).toEqual({ name: 'employees' })
  })
  it('carries a reorder in the Create Order address', () => {
    const prefill = { employeeId: 'e1', items: [{ id: 'gloves', quantity: 10 }, { id: 'shoes', quantity: 1 }] }
    const path = pathOf({ name: 'createOrder', prefill })
    expect(path).toBe('/orders/new?employee=e1&item=gloves%3A10&item=shoes%3A1')
    const [pathname, search] = path.split('?')
    expect(parsePath(pathname!, `?${search}`)).toEqual({ name: 'createOrder', prefill })
    // Only the employee: a new order for them, with no items yet.
    expect(parsePath('/orders/new', '?employee=e1')).toEqual({ name: 'createOrder', prefill: { employeeId: 'e1', items: [] } })
    // Malformed: an ordinary new order.
    expect(parsePath('/orders/new', '?employee=e1&item=gloves:0')).toEqual({ name: 'createOrder' })
    expect(parsePath('/orders/new', '?item=gloves:0')).toEqual({ name: 'createOrder' })
  })
  it('carries an item set\'s items without an employee', () => {
    const prefill = { items: [{ id: 'shoes', quantity: 1 }, { id: 'gloves', quantity: 10 }] }
    const path = pathOf({ name: 'createOrder', prefill })
    expect(path).toBe('/orders/new?item=shoes%3A1&item=gloves%3A10')
    const [pathname, search] = path.split('?')
    expect(parsePath(pathname!, `?${search}`)).toEqual({ name: 'createOrder', prefill })
    expect(parsePath('/orders/new', '?other=1')).toEqual({ name: 'createOrder' })
  })
  it('sends unknown paths and the root to the start screen', () => {
    expect(parsePath('/')).toEqual({ name: 'home' })
    expect(parsePath('/nope')).toEqual({ name: 'home' })
    expect(parsePath('/employees/')).toEqual({ name: 'employees' })
    expect(parsePath('/confirm/')).toEqual({ name: 'home' })
  })
  it('starts each role on its own dashboard, and keeps each dashboard to its role', () => {
    const admin = { isAdmin: true, isManager: false, isEmployee: false }
    const manager = { isAdmin: false, isManager: true, isEmployee: false }
    const employee = { isAdmin: false, isManager: false, isEmployee: true }
    const both = { isAdmin: true, isManager: true, isEmployee: false }
    const managerEmployee = { isAdmin: false, isManager: true, isEmployee: true }
    const none = { isAdmin: false, isManager: false, isEmployee: false }
    expect(startRoute({ name: 'home' }, admin)).toEqual({ name: 'dashboard' })
    expect(startRoute({ name: 'home' }, manager)).toEqual({ name: 'managerDashboard' })
    expect(startRoute({ name: 'home' }, employee)).toEqual({ name: 'employeeDashboard' })
    expect(startRoute({ name: 'home' }, both)).toEqual({ name: 'dashboard' })
    expect(startRoute({ name: 'home' }, managerEmployee)).toEqual({ name: 'managerDashboard' })
    expect(startRoute({ name: 'home' }, none)).toEqual({ name: 'createOrder' })

    expect(startRoute({ name: 'dashboard' }, manager)).toEqual({ name: 'managerDashboard' })
    expect(startRoute({ name: 'dashboard' }, employee)).toEqual({ name: 'employeeDashboard' })
    expect(startRoute({ name: 'managerDashboard' }, admin)).toEqual({ name: 'dashboard' })
    expect(startRoute({ name: 'managerDashboard' }, employee)).toEqual({ name: 'employeeDashboard' })
    expect(startRoute({ name: 'managerDashboard' }, both)).toEqual({ name: 'managerDashboard' })
    expect(startRoute({ name: 'employeeDashboard' }, admin)).toEqual({ name: 'dashboard' })
    expect(startRoute({ name: 'employeeDashboard' }, manager)).toEqual({ name: 'managerDashboard' })
    expect(startRoute({ name: 'employeeDashboard' }, managerEmployee)).toEqual({ name: 'employeeDashboard' })
    expect(startRoute({ name: 'history' }, employee)).toEqual({ name: 'history' })
  })
})
