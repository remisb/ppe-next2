import { useCallback, useEffect, useState } from 'react'

import { basePath, stripBase } from '@ppe/routing'

export type Route =
  | { name: 'createOrder' }
  | { name: 'history' }
  | { name: 'employees' }
  | { name: 'catalogue' }
  | { name: 'itemSets' }
  | { name: 'account' }
  /** View Record; print opens the browser's print dialog once loaded (Print Record). */
  | { name: 'record'; id: string; print?: boolean }
  /** The employee's public confirmation page; the token is its only credential. */
  | { name: 'confirm'; token: string }

const fixed = {
  createOrder: '/orders/new',
  history: '/history',
  employees: '/employees',
  catalogue: '/catalogue',
  itemSets: '/item-sets',
  account: '/account',
} as const

/** Unknown paths (stale bookmarks) land on Create Order, the app's main screen. */
export function parsePath(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  for (const [name, p] of Object.entries(fixed)) {
    if (p === path) return { name } as Route
  }
  const record = /^\/orders\/([^/]+)\/record$/.exec(path)
  if (record?.[1]) return { name: 'record', id: decodeURIComponent(record[1]) }
  const confirm = /^\/confirm\/([^/]+)$/.exec(path)
  if (confirm?.[1]) return { name: 'confirm', token: decodeURIComponent(confirm[1]) }
  return { name: 'createOrder' }
}

export function pathOf(route: Route): string {
  switch (route.name) {
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
    window.history.pushState(null, '', basePath + pathOf(to))
    setRoute(to)
    window.scrollTo(0, 0)
  }, [])

  return { route, navigate }
}
