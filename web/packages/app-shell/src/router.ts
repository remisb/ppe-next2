import { basePath, stripBase } from '@ppe/routing'
import { type MouseEvent, useCallback, useEffect, useState } from 'react'

/**
 * replace: change the address without a new history entry (a consumed
 * prefill). scroll: false keeps the scroll position (a list beside its detail).
 */
export interface NavigateOptions {
  replace?: boolean
  scroll?: boolean
}

export interface Router<R> {
  route: R
  navigate: (to: R, options?: NavigateOptions) => void
}

/** An app's addresses: parse reads one (without the app's base path), pathOf writes one. */
export interface Addresses<R> {
  parse: (pathname: string, search: string) => R
  pathOf: (route: R) => string
}

/** Marks history entries pushed by navigate, so Back can return within the app. */
const inApp = { inApp: true }

/** True when the previous history entry is a screen of this app, not another site or a fresh tab. */
export function canGoBack(): boolean {
  return (window.history.state as typeof inApp | null)?.inApp === true
}

/**
 * The app's router over the History API: the route of the address it opened
 * at, kept in step with Back and Forward, and navigate to push or replace one.
 * Addresses are under the app's base path (@ppe/routing).
 */
export function useAddressRouter<R>({ parse, pathOf }: Addresses<R>): Router<R> {
  const [route, setRoute] = useState<R>(() => parse(stripBase(window.location.pathname), window.location.search))

  useEffect(() => {
    const onPop = () => setRoute(parse(stripBase(window.location.pathname), window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [parse])

  const navigate = useCallback(
    (to: R, { replace = false, scroll = true }: NavigateOptions = {}) => {
      if (replace) window.history.replaceState(window.history.state, '', basePath + pathOf(to))
      else window.history.pushState(inApp, '', basePath + pathOf(to))
      setRoute(to)
      if (scroll) window.scrollTo(0, 0)
    },
    [pathOf],
  )

  return { route, navigate }
}

/**
 * Props for an <a> that navigates in the app. A real href keeps "open in new
 * tab", middle click and copy link working; a plain click stays in the app.
 */
export function linkWith<R>(pathOf: (route: R) => string, to: R, navigate: (to: R) => void) {
  return {
    href: basePath + pathOf(to),
    onClick: (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      e.preventDefault()
      navigate(to)
    },
  }
}
