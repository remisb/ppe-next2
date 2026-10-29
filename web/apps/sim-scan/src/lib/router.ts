import { type Addresses, linkWith, useAddressRouter } from '@ppe/app-shell'

/** The trial's two screens, at their addresses under /sim-scan. */
export type Route = { name: 'scan' } | { name: 'find' }

export const addresses: Addresses<Route> = {
  parse: (pathname) => (pathname.replace(/\/+$/, '') === '/find' ? { name: 'find' } : { name: 'scan' }),
  pathOf: (route) => (route.name === 'find' ? '/find' : '/'),
}

export const useRouter = () => useAddressRouter(addresses)

export const linkTo = (to: Route, navigate: (to: Route) => void) => linkWith(addresses.pathOf, to, navigate)
