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

/**
 * An app's addresses: parse reads one (without the app's base path), pathOf
 * writes one. fromOf names where a link to route was followed from ("WE-000010"),
 * kept with the history entry it pushes (cameFrom), not in the address.
 */
export interface Addresses<R> {
  parse: (pathname: string, search: string) => R
  pathOf: (route: R) => string
  fromOf?: ((route: R) => string | undefined) | undefined
}

/** Marks history entries pushed by navigate, so Back can return within the app. */
const inApp = { inApp: true }

/** True when the previous history entry is a screen of this app, not another site or a fresh tab. */
export function canGoBack(): boolean {
  return (window.history.state as typeof inApp | null)?.inApp === true
}

/**
 * Where the current screen was opened from, as its link named it (Addresses'
 * fromOf): kept with the history entry, so it survives a reload, Back and
 * Forward; none for an address opened directly.
 */
export function cameFrom(): string | undefined {
  const state = window.history.state as { inApp?: boolean; from?: unknown } | null
  return state?.inApp === true && typeof state.from === 'string' ? state.from : undefined
}

/**
 * The app's router over the History API: the route of the address it opened
 * at, kept in step with Back and Forward, and navigate to push or replace one.
 * Addresses are under the app's base path (@ppe/routing).
 */
export function useAddressRouter<R>({ parse, pathOf, fromOf }: Addresses<R>): Router<R> {
  const [route, setRoute] = useState<R>(() => parse(stripBase(window.location.pathname), window.location.search))

  useEffect(() => {
    const onPop = () => setRoute(parse(stripBase(window.location.pathname), window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [parse])

  const navigate = useCallback(
    (to: R, { replace = false, scroll = true }: NavigateOptions = {}) => {
      if (replace) window.history.replaceState(window.history.state, '', basePath + pathOf(to))
      else {
        const from = fromOf?.(to)
        window.history.pushState(from ? { ...inApp, from } : inApp, '', basePath + pathOf(to))
      }
      setRoute(to)
      if (scroll) window.scrollTo(0, 0)
    },
    [pathOf, fromOf],
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
