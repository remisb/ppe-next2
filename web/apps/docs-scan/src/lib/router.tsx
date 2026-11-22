import { type Addresses, type Router, linkWith, useAddressRouter } from '@ppe/app-shell'
import { createContext, type ReactNode, useContext } from 'react'

/**
 * Scan Documents' screens, at their addresses under where it is mounted (/apps/<slug>/, a
 * channel's or a version's), each its own address so a phone's back gesture and a reload work
 * (docs/apps/docs-scan-plan.md, section 2). A scan's screens are under its kept scan's id.
 */
export type Route =
  | { name: 'home' }
  | { name: 'camera' }
  | { name: 'scan'; id: string }
  | { name: 'find'; id: string }
  | { name: 'update'; id: string; employee: string }
  | { name: 'merge'; id: string }
  | { name: 'new'; id: string }
  | { name: 'saved'; id: string }
  | { name: 'adjust'; id: string; page: number }

const ID = /^[0-9a-f-]{36}$/i

export const addresses: Addresses<Route> = {
  parse: (pathname) => {
    const [first, id, step, arg, ...rest] = pathname.split('/').filter(Boolean)
    if (first === 'camera' && !id) return { name: 'camera' }
    if (first !== 'scan' || !id || !ID.test(id) || rest.length > 0) return { name: 'home' }
    if (!step) return { name: 'scan', id }
    if (step === 'find' && !arg) return { name: 'find', id }
    if (step === 'merge' && !arg) return { name: 'merge', id }
    if (step === 'new' && !arg) return { name: 'new', id }
    if (step === 'saved' && !arg) return { name: 'saved', id }
    if (step === 'update' && arg && ID.test(arg)) return { name: 'update', id, employee: arg }
    if (step === 'adjust' && arg && /^[1-9]\d?$/.test(arg)) return { name: 'adjust', id, page: Number(arg) }
    return { name: 'scan', id }
  },
  pathOf: (r) => {
    switch (r.name) {
      case 'home':
        return '/'
      case 'camera':
        return '/camera'
      case 'scan':
        return `/scan/${r.id}`
      case 'update':
        return `/scan/${r.id}/update/${r.employee}`
      case 'adjust':
        return `/scan/${r.id}/adjust/${r.page}`
      default:
        return `/scan/${r.id}/${r.name}`
    }
  },
}

const Current = createContext<Router<Route> | null>(null)

/** The app's one router: every screen reads and moves the same one (a router per screen would not see the others' moves). */
export function RouterProvider({ children }: { children: ReactNode }) {
  return <Current.Provider value={useAddressRouter(addresses)}>{children}</Current.Provider>
}

export function useRouter(): Router<Route> {
  const r = useContext(Current)
  if (!r) throw new Error('useRouter outside RouterProvider')
  return r
}

export const linkTo = (to: Route, navigate: (to: Route) => void) => linkWith(addresses.pathOf, to, navigate)
