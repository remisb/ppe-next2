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
      'assets',
      'catalogue',
      'itemSets',
      'history',
      'account',
      'replacements',
    ] as const) {
      expect(parsePath(pathOf({ name }))).toEqual({ name })
    }
    expect(pathOf({ name: 'assets' })).toBe('/assets')
    expect(pathOf({ name: 'assets', tile: 'notReturned' })).toBe('/assets?show=not-returned')
    expect(parsePath('/assets', '?show=in-office')).toEqual({ name: 'assets', tile: 'inOffice' })
    expect(parsePath('/assets', '?show=everything')).toEqual({ name: 'assets' })
    expect(pathOf({ name: 'assets', equipment: true, tile: 'inOffice' })).toBe('/assets?kind=equipment&show=in-office')
    expect(parsePath('/assets', '?kind=equipment')).toEqual({ name: 'assets', equipment: true })
    expect(parsePath(pathOf({ name: 'asset', id: 'a/1' }))).toEqual({ name: 'asset', id: 'a/1' })
    const draft = { name: 'assetForm', id: 'a1', draft: { employeeId: 'e1', givenDate: '2026-10-09', plan: 'Biz 10 GB', valueCents: 2500 }, print: true } as const
    expect(pathOf(draft)).toBe('/assets/a1/form?employee=e1&date=2026-10-09&plan=Biz+10+GB&value=2500&print=1')
    expect(parsePath('/assets/a1/form', '?employee=e1&date=2026-10-09&plan=Biz+10+GB&value=2500&print=1')).toEqual(draft)
    expect(parsePath(pathOf({ name: 'assetForm', id: 'a1', assignment: 's1' }))).toEqual({ name: 'assetForm', id: 'a1', assignment: 's1' })
    expect(parsePath('/assets/a1/form', '?employee=e1&date=9.10.2026')).toEqual({ name: 'assetForm', id: 'a1' })
    expect(parsePath(pathOf({ name: 'employee', id: 'a/b' }))).toEqual({ name: 'employee', id: 'a/b' })
    expect(parsePath(pathOf({ name: 'catalogueItem', id: 'x/y' }))).toEqual({ name: 'catalogueItem', id: 'x/y' })
    expect(parsePath(pathOf({ name: 'record', id: 'a b' }))).toEqual({ name: 'record', id: 'a b' })
    expect(parsePath(pathOf({ name: 'confirm', token: 'Ab-_9' }))).toEqual({ name: 'confirm', token: 'Ab-_9' })
    expect(parsePath(pathOf({ name: 'history', order: 'o 1' }))).toEqual({ name: 'history', order: 'o 1' })
  })
  it('sends the old addresses of Users, Settings and Backups on to Administration', () => {
    expect(parsePath('/users')).toEqual({ name: 'administration', path: '/users' })
    expect(parsePath('/settings/')).toEqual({ name: 'administration', path: '/settings' })
    expect(parsePath('/backups')).toEqual({ name: 'administration', path: '/backups' })
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
  it('starts each role on its own dashboard, and keeps each dashboard to its permission', () => {
    const holding = (...perms: string[]) => (p: string) => perms.includes(p)
    const admin = holding('users.manage', 'settings.manage', 'backups.read', 'dashboard.overview')
    const manager = holding('orders.delete', 'dashboard.manager')
    const employee = holding('dashboard.employee')
    const both = holding('dashboard.overview', 'settings.manage', 'backups.read', 'dashboard.manager')
    const managerEmployee = holding('dashboard.manager', 'dashboard.employee')
    const none = holding('catalogue.manage')
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
