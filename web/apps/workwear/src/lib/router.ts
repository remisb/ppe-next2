import { type MouseEvent, useCallback, useEffect, useState } from 'react'

import { basePath, stripBase } from '@ppe/routing'

export type Route =
  /** The root: the signed-in user's start screen, the Dashboard for administrators and Create Order for everyone else. */
  | { name: 'home' }
  /** The administrator's dashboard. */
  | { name: 'dashboard' }
  | { name: 'createOrder' }
  | { name: 'history' }
  | { name: 'employees' }
  /** One employee: details, sizes and the items issued to them. */
  | { name: 'employee'; id: string }
  | { name: 'catalogue' }
  | { name: 'itemSets' }
  /** User accounts; administrators only. */
  | { name: 'users' }
  | { name: 'account' }
  /** View Record; print opens the browser's print dialog once loaded (Print Record). */
  | { name: 'record'; id: string; print?: boolean }
  /** The employee's public confirmation page; the token is its only credential. */
  | { name: 'confirm'; token: string }

const fixed = {
  home: '/',
  dashboard: '/dashboard',
  createOrder: '/orders/new',
  history: '/history',
  employees: '/employees',
  catalogue: '/catalogue',
  itemSets: '/item-sets',
  users: '/users',
  account: '/account',
} as const

/** Unknown paths (stale bookmarks) land on the start screen, as the root does. */
export function parsePath(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  for (const [name, p] of Object.entries(fixed)) {
    if (p === path) return { name } as Route
  }
  const employee = /^\/employees\/([^/]+)$/.exec(path)
  if (employee?.[1]) return { name: 'employee', id: decodeURIComponent(employee[1]) }
  const record = /^\/orders\/([^/]+)\/record$/.exec(path)
  if (record?.[1]) return { name: 'record', id: decodeURIComponent(record[1]) }
  const confirm = /^\/confirm\/([^/]+)$/.exec(path)
  if (confirm?.[1]) return { name: 'confirm', token: decodeURIComponent(confirm[1]) }
  return { name: 'home' }
}

export function pathOf(route: Route): string {
  switch (route.name) {
    case 'employee':
      return `/employees/${encodeURIComponent(route.id)}`
    case 'record':
      return `/orders/${encodeURIComponent(route.id)}/record`
    case 'confirm':
      return `/confirm/${encodeURIComponent(route.token)}`
    default:
      return fixed[route.name]
  }
}

export interface Router {
  route: Route
  navigate: (to: Route) => void
}

export function useRouter(): Router {
  const [route, setRoute] = useState<Route>(() => parsePath(stripBase(window.location.pathname)))

  useEffect(() => {
    const onPop = () => setRoute(parsePath(stripBase(window.location.pathname)))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to: Route) => {
    window.history.pushState(inApp, '', basePath + pathOf(to))
    setRoute(to)
    window.scrollTo(0, 0)
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
 * for administrators, Create Order for everyone else. The Dashboard is
 * administrators' only, so anyone else asking for it gets their start screen.
 */
export function startRoute(route: Route, isAdmin: boolean): Route {
  if (route.name === 'home' || (route.name === 'dashboard' && !isAdmin)) {
    return isAdmin ? { name: 'dashboard' } : { name: 'createOrder' }
  }
  return route
}
