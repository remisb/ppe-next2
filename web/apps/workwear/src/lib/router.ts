import { type MouseEvent, useCallback, useEffect, useState } from 'react'

import type { OrderStatus } from '@ppe/api-client'
import { basePath, stripBase } from '@ppe/routing'

export type Route =
  /** The root: the signed-in user's start screen (see startRoute). */
  | { name: 'home' }
  /** The administrator's dashboard. */
  | { name: 'dashboard' }
  /** The manager's dashboard. */
  | { name: 'managerDashboard' }
  /** The employee role's dashboard: the user's own orders and what to order next. */
  | { name: 'employeeDashboard' }
  /** Create Order; prefill starts it for an employee with these items (a reorder from a dashboard). */
  | { name: 'createOrder'; prefill?: Prefill }
  /**
   * History; order opens one order beside the list, or on its own on a narrow
   * screen; status opens it on that tab (a dashboard's Awaiting tile).
   */
  | { name: 'history'; order?: string; status?: OrderStatus }
  /** Employees; missing opens it filtered to those missing a size (a dashboard's Missing sizes tile). */
  | { name: 'employees'; missing?: boolean }
  /** One employee: details, sizes and the items issued to them. */
  | { name: 'employee'; id: string }
  | { name: 'catalogue' }
  /** One catalogue item: its current values and the item sets that hold it. */
  | { name: 'catalogueItem'; id: string }
  | { name: 'itemSets' }
  /** User accounts; administrators only. */
  | { name: 'users' }
  /** The organisation's settings (the supplier's WhatsApp group); administrators only. */
  | { name: 'settings' }
  /** Replacements due: every item due for replacement, reached from a dashboard's tile. */
  | { name: 'replacements' }
  | { name: 'account' }
  /** The user guide, for the user's roles; /help#<section> opens it at a section. */
  | { name: 'help' }
  /** View Record; print opens the browser's print dialog once loaded (Print Record). */
  | { name: 'record'; id: string; print?: boolean }
  /** The employee's public confirmation page; the token is its only credential. */
  | { name: 'confirm'; token: string }

/**
 * Items to start an order with: a reorder (for the employee, each at the
 * quantity given last time) or an item set's items (Use in new order, for
 * whoever the order is for).
 */
export interface Prefill {
  employeeId?: string
  items: { id: string; quantity: number }[]
}

const fixed = {
  home: '/',
  dashboard: '/dashboard',
  managerDashboard: '/manager',
  employeeDashboard: '/my-orders',
  createOrder: '/orders/new',
  history: '/orders',
  employees: '/employees',
  catalogue: '/catalogue',
  itemSets: '/item-sets',
  users: '/users',
  settings: '/settings',
  replacements: '/replacements',
  account: '/account',
  help: '/help',
} as const

/** Unknown paths (stale bookmarks) land on the start screen, as the root does. */
export function parsePath(pathname: string, search = ''): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  const query = new URLSearchParams(search)
  if (path === fixed.createOrder) {
    const prefill = parsePrefill(query)
    return prefill ? { name: 'createOrder', prefill } : { name: 'createOrder' }
  }
  // /history is the screen's old address (it was called History), kept for bookmarks and links already sent.
  if (path === fixed.history || path === '/history') {
    const status = query.get('status')
    return status === 'ORDERED' || status === 'GIVEN' ? { name: 'history', status } : { name: 'history' }
  }
  if (path === fixed.employees) return query.get('missing') === '1' ? { name: 'employees', missing: true } : { name: 'employees' }
  for (const [name, p] of Object.entries(fixed)) {
    if (p === path) return { name } as Route
  }
  const order = /^\/(?:orders|history)\/([^/]+)$/.exec(path)
  if (order?.[1]) return { name: 'history', order: decodeURIComponent(order[1]) }
  const employee = /^\/employees\/([^/]+)$/.exec(path)
  if (employee?.[1]) return { name: 'employee', id: decodeURIComponent(employee[1]) }
  const item = /^\/catalogue\/([^/]+)$/.exec(path)
  if (item?.[1]) return { name: 'catalogueItem', id: decodeURIComponent(item[1]) }
  const record = /^\/orders\/([^/]+)\/record$/.exec(path)
  if (record?.[1]) return { name: 'record', id: decodeURIComponent(record[1]) }
  const confirm = /^\/confirm\/([^/]+)$/.exec(path)
  if (confirm?.[1]) return { name: 'confirm', token: decodeURIComponent(confirm[1]) }
  return { name: 'home' }
}

/** ?employee=<id>&item=<id>:<quantity>&item=… (one of the two at least); anything malformed is no prefill. */
function parsePrefill(q: URLSearchParams): Prefill | undefined {
  const employeeId = q.get('employee')
  const items: Prefill['items'] = []
  for (const raw of q.getAll('item')) {
    const [id, qty] = raw.split(':')
    const quantity = Number(qty ?? '1')
    if (!id || !Number.isInteger(quantity) || quantity < 1) return undefined
    items.push({ id, quantity })
  }
  // No items is a new order for the employee (New order on their page);
  // no employee, items for whoever the order is for (an item set's Use in new order).
  if (!employeeId) return items.length > 0 ? { items } : undefined
  return { employeeId, items }
}

export function pathOf(route: Route): string {
  switch (route.name) {
    case 'createOrder': {
      if (!route.prefill) return fixed.createOrder
      const q = new URLSearchParams(route.prefill.employeeId ? { employee: route.prefill.employeeId } : {})
      for (const i of route.prefill.items) q.append('item', `${i.id}:${i.quantity}`)
      return `${fixed.createOrder}?${q}`
    }
    case 'history':
      if (route.order) return `${fixed.history}/${encodeURIComponent(route.order)}`
      return route.status ? `${fixed.history}?status=${route.status}` : fixed.history
    case 'employees':
      return route.missing ? `${fixed.employees}?missing=1` : fixed.employees
    case 'employee':
      return `/employees/${encodeURIComponent(route.id)}`
    case 'catalogueItem':
      return `/catalogue/${encodeURIComponent(route.id)}`
    case 'record':
      return `/orders/${encodeURIComponent(route.id)}/record`
    case 'confirm':
      return `/confirm/${encodeURIComponent(route.token)}`
    default:
      return fixed[route.name]
  }
}

/**
 * replace: change the address without a new history entry (a consumed
 * prefill). scroll: false keeps the scroll position (a list beside its detail).
 */
export interface NavigateOptions {
  replace?: boolean
  scroll?: boolean
}

export interface Router {
  route: Route
  navigate: (to: Route, options?: NavigateOptions) => void
}

export function useRouter(): Router {
  const [route, setRoute] = useState<Route>(() => parsePath(stripBase(window.location.pathname), window.location.search))

  useEffect(() => {
    // An old /history address shows as the screen's own, /orders; once, for the address the page opened at.
    if (/^\/history(\/|$)/.test(stripBase(window.location.pathname))) window.history.replaceState(window.history.state, '', basePath + pathOf(route))
  }, [])

  useEffect(() => {
    const onPop = () => setRoute(parsePath(stripBase(window.location.pathname), window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to: Route, { replace = false, scroll = true }: NavigateOptions = {}) => {
    if (replace) window.history.replaceState(window.history.state, '', basePath + pathOf(to))
    else window.history.pushState(inApp, '', basePath + pathOf(to))
    setRoute(to)
    if (scroll) window.scrollTo(0, 0)
  }, [])

  return { route, navigate }
}

/** Marks history entries pushed by navigate, so Back can return within the app. */
const inApp = { inApp: true }

/** True when the previous history entry is a screen of this app, not another site or a fresh tab. */
export function canGoBack(): boolean {
  return (window.history.state as typeof inApp | null)?.inApp === true
}

/**
 * Props for an <a> that navigates in the app. A real href keeps "open in new
 * tab", middle click and copy link working; a plain click stays in the app.
 */
export function linkTo(to: Route, navigate: (to: Route) => void) {
  return {
    href: basePath + pathOf(to),
    onClick: (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      e.preventDefault()
      navigate(to)
    },
  }
}

/**
 * The screen to show for route. The root is the start screen: the Dashboard
 * for administrators, the Manager Dashboard for managers, the Employee
 * Dashboard for the employee role, in that order when a user holds several;
 * Create Order for anyone else. Each dashboard belongs to its role alone, so
 * anyone else asking for it gets their own start screen.
 */
export function startRoute(route: Route, roles: { isAdmin: boolean; isManager: boolean; isEmployee: boolean }): Route {
  const home: Route = roles.isAdmin
    ? { name: 'dashboard' }
    : roles.isManager
      ? { name: 'managerDashboard' }
      : roles.isEmployee
        ? { name: 'employeeDashboard' }
        : { name: 'createOrder' }
  if (route.name === 'home') return home
  if (route.name === 'dashboard' && !roles.isAdmin) return home
  if (route.name === 'managerDashboard' && !roles.isManager) return home
  if (route.name === 'employeeDashboard' && !roles.isEmployee) return home
  if (route.name === 'settings' && !roles.isAdmin) return home
  return route
}
