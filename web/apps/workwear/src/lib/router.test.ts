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
      'simCards',
      'equipment',
      'catalogue',
      'itemSets',
      'history',
      'account',
      'replacements',
    ] as const) {
      expect(parsePath(pathOf({ name }))).toEqual({ name })
    }
    expect(pathOf({ name: 'simCards' })).toBe('/assets/sim-cards')
    expect(pathOf({ name: 'simCards', tile: 'notReturned' })).toBe('/assets/sim-cards?show=not-returned')
    expect(parsePath('/assets/sim-cards', '?show=in-office')).toEqual({ name: 'simCards', tile: 'inOffice' })
    expect(parsePath('/assets/sim-cards', '?show=everything')).toEqual({ name: 'simCards' })
    // A SIM open beside the register keeps the tile the register was opened on.
    expect(pathOf({ name: 'simCards', asset: 'a/1' })).toBe('/assets/sim-cards/a%2F1')
    expect(parsePath(pathOf({ name: 'simCards', asset: 'a/1' }))).toEqual({ name: 'simCards', asset: 'a/1' })
    expect(parsePath('/assets/sim-cards/a1', '?show=in-office')).toEqual({ name: 'simCards', asset: 'a1', tile: 'inOffice' })
    // An item open beside Equipment, likewise.
    expect(pathOf({ name: 'equipment', asset: 'e1', tile: 'withEmployees' })).toBe('/assets/equipment/e1?show=with-employees')
    expect(parsePath(pathOf({ name: 'equipment', asset: 'e/1' }))).toEqual({ name: 'equipment', asset: 'e/1' })
    expect(pathOf({ name: 'equipment', tile: 'inOffice' })).toBe('/assets/equipment?show=in-office')
    expect(parsePath('/assets/equipment', '?show=in-office')).toEqual({ name: 'equipment', tile: 'inOffice' })
    // The old address of the two registers, when they were tabs of one screen: bookmarks and links already sent.
    expect(parsePath('/assets', '?show=in-office')).toEqual({ name: 'simCards', tile: 'inOffice' })
    expect(parsePath('/assets', '?kind=equipment&show=not-returned')).toEqual({ name: 'equipment', tile: 'notReturned' })
    expect(parsePath(pathOf({ name: 'asset', id: 'a/1' }))).toEqual({ name: 'asset', id: 'a/1' })
    const draft = { name: 'assetForm', id: 'a1', draft: { employeeId: 'e1', givenDate: '2026-10-09', plan: 'Biz 10 GB', valueCents: 2500 }, print: true } as const
    expect(pathOf(draft)).toBe('/assets/a1/form?employee=e1&date=2026-10-09&plan=Biz+10+GB&value=2500&print=1')
    expect(parsePath('/assets/a1/form', '?employee=e1&date=2026-10-09&plan=Biz+10+GB&value=2500&print=1')).toEqual(draft)
    expect(parsePath(pathOf({ name: 'assetForm', id: 'a1', assignment: 's1' }))).toEqual({ name: 'assetForm', id: 'a1', assignment: 's1' })
    expect(parsePath('/assets/a1/form', '?employee=e1&date=9.10.2026')).toEqual({ name: 'assetForm', id: 'a1' })
    expect(parsePath(pathOf({ name: 'employee', id: 'a/b' }))).toEqual({ name: 'employee', id: 'a/b' })
    // An item open beside the Item Catalogue, at the address its own page had.
    expect(pathOf({ name: 'catalogue', item: 'x/y' })).toBe('/catalogue/x%2Fy')
    expect(parsePath(pathOf({ name: 'catalogue', item: 'x/y' }))).toEqual({ name: 'catalogue', item: 'x/y' })
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
  it('keeps Equipment to the Equipment Assignments role: anyone else gets the SIM cards, on the same tile', () => {
    const admin = (p: string) => p !== 'equipment.read'
    const assignments = (p: string) => p === 'equipment.read'
    expect(startRoute({ name: 'equipment', tile: 'inOffice' }, admin)).toEqual({ name: 'simCards', tile: 'inOffice' })
    expect(startRoute({ name: 'equipment' }, admin)).toEqual({ name: 'simCards' })
    expect(startRoute({ name: 'equipment' }, assignments)).toEqual({ name: 'equipment' })
  })
})
