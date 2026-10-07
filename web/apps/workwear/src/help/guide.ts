import type { Permission, RoleKey as Role } from '@ppe/api-client'

/**
 * The user guide as data, one Guide per language (help/en.ts, lt.ts, ru.ts):
 * the Help screen renders it for the signed-in user's roles and the device
 * it is read on (phone, tablet or desktop, each with its own screenshots and,
 * where the screens differ, its own words); `pnpm guide` in web/e2e takes the
 * screenshots it names on each device and writes docs/guide from the desktop
 * guide with every role's parts. help.test.ts keeps the three languages in step.
 *
 * Text may hold **bold** (a control's name, as the app shows it) and `keys`
 * (a key, or a value as typed); `inline` splits it.
 */
export interface Guide {
  /** The guide's own words around the sections, in its language. */
  title: string
  lede: string
  /** The language and device switches' labels, the contents' label and the shortcuts table's columns. */
  language: string
  device: string
  devices: Record<Device, string>
  contents: string
  key: string
  does: string
  /** Who a part is for, where the guide shows every part (docs/guide). */
  onlyFor: (roles: readonly Role[]) => string
  sections: Section[]
  footer: string
}

export interface Section {
  /** The section's address on the Help screen and in the docs: /help#orders. */
  id: SectionId
  title: string
  /** Another title on these devices, where the section is about something else there. */
  titleOn?: Partial<Record<Device, string>>
  roles?: readonly Role[]
  blocks: Block[]
}

/**
 * Where the guide is read, by the app's own layout: a phone (below md, 768px:
 * the bar at the bottom), a tablet (the rail, up to xl) and a desktop (the
 * sidebar, from 1280px, with a keyboard and a mouse).
 */
export type Device = 'phone' | 'tablet' | 'desktop'

export const deviceOrder: readonly Device[] = ['phone', 'tablet', 'desktop']

/** The device class of a window this many CSS pixels wide. */
export function deviceFor(width: number): Device {
  return width < 768 ? 'phone' : width < 1280 ? 'tablet' : 'desktop'
}

export type SectionId =
  | 'sign-in'
  | 'dashboard'
  | 'create'
  | 'review'
  | 'confirm'
  | 'orders'
  | 'record'
  | 'employees'
  | 'catalogue'
  | 'administration'
  | 'overview'
  | 'users'
  | 'roles'
  | 'audit'
  | 'security'
  | 'system'
  | 'backups'
  | 'usage'
  | 'settings'
  | 'account'
  | 'shortcuts'

/** A part of a section; roles limits it to users with any of them, devices to those devices. */
export type Block = (
  | { p: string }
  | { ol: Item[] }
  | { ul: Item[] }
  /** Keyboard shortcuts: the keys, then what they do. */
  | { keys: [string, string][] }
  /** One screenshot, or two side by side. */
  | { shots: Shot[] }
) & { roles?: readonly Role[]; devices?: readonly Device[] }

export type Item = string | { text: string; items?: Item[]; roles?: readonly Role[]; devices?: readonly Device[] }

/** The screenshots `pnpm guide` takes, in each language. */
export type ShotName =
  | 'sign-in'
  | 'dashboard'
  | 'create-order'
  | 'review'
  | 'ordered'
  | 'confirm-phone'
  | 'history'
  | 'record'
  | 'employees'
  | 'employee'
  | 'catalogue'
  | 'item-sets'
  | 'overview'
  | 'users'
  | 'roles'
  | 'role'
  | 'audit-log'
  | 'security'
  | 'access-review'
  | 'system'
  | 'errors'
  | 'usage'
  | 'settings'
  | 'backups'
  | 'account'
  | 'devices'
  | 'palette'

export interface Shot {
  name: ShotName
  alt: string
  /** Always a phone's screen, whatever the device (sign-in, the employee's confirmation). */
  phone?: boolean
}

/**
 * Whose parts of Help a user reads: each built-in role's, for the permissions
 * that set that role apart. Help's text is written per role.
 */
export function helpAudiences(s: { can: (p: Permission) => boolean }): Role[] {
  const out: Role[] = []
  if (s.can('users.manage') || s.can('dashboard.overview')) out.push('admin')
  if (s.can('orders.delete') || s.can('dashboard.manager')) out.push('manager')
  if (s.can('dashboard.employee')) out.push('employee')
  return out
}

/** Whether a part limited to `roles` is for a user with `user`. */
export function isFor(roles: readonly Role[] | undefined, user: readonly Role[]): boolean {
  return !roles || roles.some((r) => user.includes(r))
}

/**
 * The guide for one reader: without what their roles cannot do (all roles'
 * parts when roles is left out) and, for a device, only its parts and titles.
 */
export function forReader(guide: Guide, { roles, device }: { roles?: readonly Role[]; device: Device }): Guide {
  const keep = (p: { roles?: readonly Role[]; devices?: readonly Device[] }) =>
    (!roles || isFor(p.roles, roles)) && (!p.devices || p.devices.includes(device))
  const items = (list: Item[]): Item[] =>
    list
      .filter((i) => typeof i === 'string' || keep(i))
      .map((i) => (typeof i === 'string' || !i.items ? i : { ...i, items: items(i.items) }))
  const blocks = (list: Block[]): Block[] =>
    list.filter(keep).map((b) => ('ol' in b ? { ...b, ol: items(b.ol) } : 'ul' in b ? { ...b, ul: items(b.ul) } : b))
  return {
    ...guide,
    sections: guide.sections
      .filter((s) => !roles || isFor(s.roles, roles))
      .map((s) => ({ ...s, title: s.titleOn?.[device] ?? s.title, blocks: blocks(s.blocks) })),
  }
}

export type Span = { kind: 'text' | 'bold' | 'keys'; text: string }

/** Splits a guide text into plain text, **bold** and `keys`. */
export function inline(text: string): Span[] {
  const spans: Span[] = []
  for (const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
    if (!part) continue
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) spans.push({ kind: 'bold', text: part.slice(2, -2) })
    else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) spans.push({ kind: 'keys', text: part.slice(1, -1) })
    else spans.push({ kind: 'text', text: part })
  }
  return spans
}

/** Where a screenshot is served from: the app's public/help-img/<lang>/<device>/<name>.png; a phone-only one from the phone's. */
export function shotPath(lang: string, device: Device, shot: Pick<Shot, 'name' | 'phone'>): string {
  return `help-img/${lang}/${shot.phone ? 'phone' : device}/${shot.name}.png`
}
