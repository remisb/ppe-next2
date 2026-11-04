import type { Permission } from '@ppe/api-client'
import { ADMINISTRATION_PERMISSIONS } from '@ppe/app-shell'
import { adminHref, simScanHref, staffHref } from '@ppe/routing'

/**
 * Every app and shortcut App Launcher shows (ADR 0006, phase 1: a list in code;
 * phase 2 moves it to the API). An app is something you open; a shortcut opens
 * one screen inside an app. Who sees a tile is decided here, by permission;
 * what they can do inside is still decided by the API.
 */

/** Where a tile sits. */
export type AppGroup = 'workwear' | 'assets' | 'people' | 'admin'
export const APP_GROUPS: readonly AppGroup[] = ['workwear', 'assets', 'people', 'admin']

/** Live, Pilot (a trial), POC, In development. Only Live shows no badge. */
export type AppStage = 'live' | 'pilot' | 'poc' | 'dev'

/** Built here: on this origin, with the user's sign-in. Linked: another site, with its own. */
export type AppTier = 'here' | 'linked'

/** The tile's picture, drawn by the launcher. */
export type AppIcon = 'shirt' | 'order' | 'orders' | 'employees' | 'dashboard' | 'sim' | 'equipment' | 'scan' | 'crew' | 'admin' | 'help'

export interface LauncherApp {
  /** Its slug: stable, used for pins and recent apps. */
  id: string
  kind: 'app' | 'shortcut'
  /** A shortcut's app. */
  parent?: string
  group: AppGroup
  icon: AppIcon
  /** The tile's colour; its text is white, so each passes 4.5:1 against white. */
  color: string
  /** A path on this origin, or a linked site's https address. */
  href: string
  tier: AppTier
  stage: AppStage
  /** Seen by a user who holds any of these; none: by every signed-in user. */
  anyOf: readonly Permission[]
  /** A product's own name, the same in every language; else the name is in the dictionaries. */
  productName?: string
}

/** Who plans crews: administrators and managers, by their dashboards. */
const CREW_PLANNERS: readonly Permission[] = ['dashboard.overview', 'dashboard.manager']

export const APPS: readonly LauncherApp[] = [
  { id: 'workwear', kind: 'app', group: 'workwear', icon: 'shirt', color: '#1c2060', href: staffHref('/'), tier: 'here', stage: 'live', anyOf: [] },
  {
    id: 'dashboard',
    kind: 'shortcut',
    parent: 'workwear',
    group: 'workwear',
    icon: 'dashboard',
    color: '#23703f',
    href: staffHref('/'),
    tier: 'here',
    stage: 'live',
    anyOf: ['dashboard.overview', 'dashboard.manager', 'dashboard.employee'],
  },
  { id: 'create-order', kind: 'shortcut', parent: 'workwear', group: 'workwear', icon: 'order', color: '#3341a8', href: staffHref('/orders/new'), tier: 'here', stage: 'live', anyOf: [] },
  { id: 'orders', kind: 'shortcut', parent: 'workwear', group: 'workwear', icon: 'orders', color: '#2a5fb4', href: staffHref('/orders'), tier: 'here', stage: 'live', anyOf: [] },
  { id: 'employees', kind: 'shortcut', parent: 'workwear', group: 'workwear', icon: 'employees', color: '#5b4bb3', href: staffHref('/employees'), tier: 'here', stage: 'live', anyOf: [] },
  { id: 'help', kind: 'shortcut', parent: 'workwear', group: 'workwear', icon: 'help', color: '#5b6475', href: staffHref('/help'), tier: 'here', stage: 'live', anyOf: [] },
  { id: 'sim-cards', kind: 'shortcut', parent: 'workwear', group: 'assets', icon: 'sim', color: '#0e7068', href: staffHref('/assets/sim-cards'), tier: 'here', stage: 'live', anyOf: [] },
  {
    id: 'equipment',
    kind: 'shortcut',
    parent: 'workwear',
    group: 'assets',
    icon: 'equipment',
    color: '#7a4e14',
    href: staffHref('/assets/equipment'),
    tier: 'here',
    stage: 'live',
    anyOf: ['equipment.read'],
  },
  { id: 'sim-scan', kind: 'app', group: 'assets', icon: 'scan', color: '#0f5f8a', href: simScanHref('/'), tier: 'here', stage: 'pilot', anyOf: ['assets.manage', 'sim_codes.read'] },
  {
    id: 'crew',
    kind: 'app',
    group: 'people',
    icon: 'crew',
    color: '#9a4f0a',
    href: 'https://crew.167.71.68.195.sslip.io/',
    tier: 'linked',
    stage: 'pilot',
    anyOf: CREW_PLANNERS,
    productName: 'PPE Crew',
  },
  { id: 'admin', kind: 'app', group: 'admin', icon: 'admin', color: '#3b4256', href: adminHref('/'), tier: 'here', stage: 'live', anyOf: ADMINISTRATION_PERMISSIONS },
]

/** Whether a user with these permissions sees the tile. */
export const sees = (app: LauncherApp, can: (p: Permission) => boolean) => app.anyOf.length === 0 || app.anyOf.some((p) => can(p))

/** The apps and shortcuts a user sees, in the list's order. */
export const visibleApps = (can: (p: Permission) => boolean) => APPS.filter((a) => sees(a, can))

/**
 * Whether the user has more than one app (shortcuts aside): only then is there
 * a launcher worth landing on and an Apps entry worth showing. Someone with one
 * app goes straight to it (decision D10); /apps/ still works for them.
 */
export const hasSeveralApps = (can: (p: Permission) => boolean) => visibleApps(can).filter((a) => a.kind === 'app').length > 1

export const appById = (id: string) => APPS.find((a) => a.id === id)
