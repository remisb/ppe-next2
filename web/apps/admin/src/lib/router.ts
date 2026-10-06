import type { Permission } from '@ppe/api-client'
import { type Router, linkWith, useAddressRouter } from '@ppe/app-shell'

/** Administration's screens, at their addresses under /admin. */
export type Route =
  /** The root: the first screen the user may open (see startRoute). */
  | { name: 'home' }
  /** User accounts and the roles each holds. */
  | { name: 'users' }
  /** Roles & permissions: what each role allows. */
  | { name: 'roles' }
  /** The organisation's settings (the supplier's WhatsApp group). */
  | { name: 'settings' }
  /** The database backups the backup service takes. */
  | { name: 'backups' }

export type Screen = Exclude<Route['name'], 'home'>

const paths: Record<Route['name'], string> = {
  home: '/',
  users: '/users',
  roles: '/roles',
  settings: '/settings',
  backups: '/backups',
}

/** The permission that opens each screen, in the Main navigation's order. */
export const screens: readonly { name: Screen; permission: Permission }[] = [
  { name: 'users', permission: 'users.manage' },
  { name: 'roles', permission: 'roles.manage' },
  { name: 'settings', permission: 'settings.manage' },
  { name: 'backups', permission: 'backups.read' },
]

/** Unknown paths land on the start screen, as the root does. */
export function parsePath(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  for (const [name, p] of Object.entries(paths)) {
    if (p === path) return { name } as Route
  }
  return { name: 'home' }
}

export function pathOf(route: Route): string {
  return paths[route.name]
}

/**
 * The screen to show for route: the root, or a screen the user may not open,
 * is the first screen they may open; none at all is null (not for them).
 */
export function startRoute(route: Route, can: (p: Permission) => boolean): Route | null {
  const allowed = screens.filter((s) => can(s.permission))
  if (route.name !== 'home' && allowed.some((s) => s.name === route.name)) return route
  return allowed[0] ? { name: allowed[0].name } : null
}

const addresses = { parse: (pathname: string) => parsePath(pathname), pathOf }

export function useRouter(): Router<Route> {
  return useAddressRouter(addresses)
}

/** Props for an <a> that navigates within Administration. */
export function linkTo(to: Route, navigate: (to: Route) => void) {
  return linkWith(pathOf, to, navigate)
}
