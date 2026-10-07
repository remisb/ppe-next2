import type { AuditEntityType, Permission } from '@ppe/api-client'
import { ADMINISTRATION_PERMISSIONS, type Router, linkWith, useAddressRouter } from '@ppe/app-shell'

/**
 * The Audit log's filters, as its address carries them (/audit?area=…), so a
 * filtered view can be bookmarked or sent to another administrator. From and
 * to are days (YYYY-MM-DD) in the organisation's timezone.
 */
export interface AuditFilter {
  area?: string
  event?: string
  actor?: string
  entity_type?: AuditEntityType
  entity_id?: string
  from?: string
  to?: string
}

const auditFilterKeys = ['area', 'event', 'actor', 'entity_type', 'entity_id', 'from', 'to'] as const

/** The Security screen's sign-in filters, in its address as the Audit log's are. */
export interface SecurityFilter {
  kind?: string
  user?: string
  from?: string
  to?: string
}

const securityFilterKeys = ['kind', 'user', 'from', 'to'] as const

/** The Security screen's tabs: sign-ins (/security), signed-in devices and the access review. */
export const securityTabs = ['sign-ins', 'devices', 'review'] as const

export type SecurityTab = (typeof securityTabs)[number]

/** System's tabs: the API and database (/system), the error list, and the backups. */
export const systemTabs = ['status', 'errors', 'backups'] as const

export type SystemTab = (typeof systemTabs)[number]

/** The permission each System tab needs. */
export const systemTabPermission: Record<SystemTab, Permission> = {
  status: 'system.read',
  errors: 'system.read',
  backups: 'backups.read',
}

/** Administration's screens, at their addresses under /admin. */
export type Route =
  /** An unknown address: the first screen the user may open (see startRoute). */
  | { name: 'home' }
  /** The Overview at the root: what needs attention, then figures. */
  | { name: 'overview' }
  /** User accounts and the roles each holds. */
  | { name: 'users' }
  /** Roles & permissions: what each role allows. */
  | { name: 'roles' }
  /** The Audit log, filtered; event is the change open beside it (/audit/<id>). */
  | { name: 'audit'; filter: AuditFilter; event?: string }
  /** Sign-ins, every user's signed-in devices and the access review; filter applies to sign-ins. */
  | { name: 'security'; tab: SecurityTab; filter: SecurityFilter }
  /** The organisation's settings (the supplier's WhatsApp group). */
  | { name: 'settings' }
  /** The API, the database, the error list (error: the one open beside it) and the backups. */
  | { name: 'system'; tab: SystemTab; error?: string }

export type Screen = Exclude<Route['name'], 'home'>

const paths: Record<Exclude<Route['name'], 'audit' | 'security' | 'system' | 'home'>, string> = {
  overview: '/',
  users: '/users',
  roles: '/roles',
  settings: '/settings',
}

/** The permissions that open each screen (any one of them), in the Main navigation's order. */
export const screens: readonly { name: Screen; permissions: readonly Permission[] }[] = [
  { name: 'overview', permissions: ADMINISTRATION_PERMISSIONS },
  { name: 'users', permissions: ['users.manage'] },
  { name: 'roles', permissions: ['roles.manage'] },
  { name: 'audit', permissions: ['audit.read'] },
  { name: 'security', permissions: ['security.read'] },
  { name: 'system', permissions: ['system.read', 'backups.read'] },
  { name: 'settings', permissions: ['settings.manage'] },
]

/** Unknown paths land on the start screen, as the root does. */
export function parsePath(pathname: string, search = ''): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  const audit = /^\/audit(?:\/([^/]+))?$/.exec(path)
  if (audit) {
    const query = new URLSearchParams(search)
    const filter: AuditFilter = {}
    for (const key of auditFilterKeys) {
      const v = query.get(key)
      if (v) (filter as Record<string, string>)[key] = v
    }
    return audit[1] ? { name: 'audit', filter, event: decodeURIComponent(audit[1]) } : { name: 'audit', filter }
  }
  const security = /^\/security(?:\/(devices|review))?$/.exec(path)
  if (security) {
    const query = new URLSearchParams(search)
    const filter: SecurityFilter = {}
    if (!security[1]) {
      for (const key of securityFilterKeys) {
        const v = query.get(key)
        if (v) filter[key] = v
      }
    }
    return { name: 'security', tab: (security[1] as SecurityTab | undefined) ?? 'sign-ins', filter }
  }
  // Backups was a screen of its own before System.
  if (path === '/backups') return { name: 'system', tab: 'backups' }
  const system = /^\/system(?:\/(errors|backups))?(?:\/([^/]+))?$/.exec(path)
  if (system) {
    const tab = (system[1] as SystemTab | undefined) ?? 'status'
    if (system[2] && tab !== 'errors') return { name: 'home' }
    return system[2] ? { name: 'system', tab, error: decodeURIComponent(system[2]) } : { name: 'system', tab }
  }
  for (const [name, p] of Object.entries(paths)) {
    if (p === path) return { name } as Route
  }
  return { name: 'home' }
}

export function pathOf(route: Route): string {
  if (route.name === 'security') {
    if (route.tab !== 'sign-ins') return `/security/${route.tab}`
    const query = new URLSearchParams()
    for (const key of securityFilterKeys) {
      const v = route.filter[key]
      if (v) query.set(key, v)
    }
    const q = query.toString()
    return q ? `/security?${q}` : '/security'
  }
  if (route.name === 'system') {
    if (route.tab === 'status') return '/system'
    return route.error ? `/system/errors/${encodeURIComponent(route.error)}` : `/system/${route.tab}`
  }
  if (route.name === 'home') return '/'
  if (route.name !== 'audit') return paths[route.name]
  const query = new URLSearchParams()
  for (const key of auditFilterKeys) {
    const v = route.filter[key]
    if (v) query.set(key, v)
  }
  const path = route.event ? `/audit/${encodeURIComponent(route.event)}` : '/audit'
  const q = query.toString()
  return q ? `${path}?${q}` : path
}

/**
 * The route of a screen opened from the navigation: the Audit log unfiltered,
 * Security and System on their first tab the user may open.
 */
export function screenRoute(name: Screen, can: (p: Permission) => boolean = () => true): Route {
  if (name === 'audit') return { name, filter: {} }
  if (name === 'security') return { name, tab: 'sign-ins', filter: {} }
  if (name === 'system') return { name, tab: systemTabs.find((tab) => can(systemTabPermission[tab])) ?? 'status' }
  return { name } as Route
}

/**
 * The screen to show for route: an unknown address, a screen the user may
 * not open, or a System tab they may not, is the first screen they may open
 * (the Overview); none at all is null (not for them).
 */
export function startRoute(route: Route, can: (p: Permission) => boolean): Route | null {
  const allowed = screens.filter((s) => s.permissions.some(can))
  if (route.name !== 'home' && allowed.some((s) => s.name === route.name)) {
    return route.name === 'system' && !can(systemTabPermission[route.tab]) ? screenRoute('system', can) : route
  }
  return allowed[0] ? screenRoute(allowed[0].name, can) : null
}

const addresses = { parse: (pathname: string, search: string) => parsePath(pathname, search), pathOf }

export function useRouter(): Router<Route> {
  return useAddressRouter(addresses)
}

/** Props for an <a> that navigates within Administration. */
export function linkTo(to: Route, navigate: (to: Route) => void) {
  return linkWith(pathOf, to, navigate)
}
