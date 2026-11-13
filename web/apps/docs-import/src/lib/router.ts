import { type Addresses, linkWith, useAddressRouter } from '@ppe/app-shell'

/**
 * The app's screens, at their addresses under where it is mounted (/apps/<slug>/, a channel's or a version's):
 * Import to Personnel at the root, Scan Document at /scan.
 */
export type Route = { name: 'home' } | { name: 'scan' }

export const addresses: Addresses<Route> = {
  parse: (pathname) => (pathname.replace(/\/+$/, '') === '/scan' ? { name: 'scan' } : { name: 'home' }),
  pathOf: (r) => (r.name === 'scan' ? '/scan' : '/'),
}

export const useRouter = () => useAddressRouter(addresses)

export const linkTo = (to: Route, navigate: (to: Route) => void) => linkWith(addresses.pathOf, to, navigate)
