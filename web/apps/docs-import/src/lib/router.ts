import { type Addresses, linkWith, useAddressRouter } from '@ppe/app-shell'

/** The app's screens, at their addresses under where it is mounted (/apps/<slug>/, a channel's or a version's). */
export type Route = { name: 'home' }

export const addresses: Addresses<Route> = {
  parse: () => ({ name: 'home' }),
  pathOf: () => '/',
}

export const useRouter = () => useAddressRouter(addresses)

export const linkTo = (to: Route, navigate: (to: Route) => void) => linkWith(addresses.pathOf, to, navigate)
