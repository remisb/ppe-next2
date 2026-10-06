import type { Permission, PermissionInfo, Role } from '@ppe/api-client'

import { t } from '@/i18n'

/**
 * Roles & permissions rules. The API enforces them (internal/domain/role);
 * these keep the form consistent before a round trip: a permission comes with
 * those it cannot work without, and goes with those that need it.
 */

export interface RoleDraft {
  name: string
  description: string
  permissions: Permission[]
}

export type RoleErrors = Partial<Record<'name' | 'description', string>>

export function draftOf(r: Role | undefined): RoleDraft {
  return { name: r?.name ?? '', description: r?.description ?? '', permissions: r ? [...r.permissions] : [] }
}

export function validateRole(d: RoleDraft): RoleErrors {
  const errors: RoleErrors = {}
  const name = d.name.trim()
  if (!name) errors.name = t.roles.enterName
  else if ([...name].length > 100) errors.name = t.roles.nameTooLong
  if ([...d.description.trim()].length > 500) errors.description = t.roles.descriptionTooLong
  return errors
}

/** perms in the catalogue's order, without duplicates. */
function ordered(perms: Iterable<Permission>, catalogue: readonly PermissionInfo[]): Permission[] {
  const set = new Set(perms)
  return catalogue.map((p) => p.key).filter((k) => set.has(k))
}

/**
 * The permissions after ticking or unticking p: ticked, it brings what it
 * requires; unticked, it takes along whatever requires it.
 */
export function togglePermission(perms: readonly Permission[], p: Permission, on: boolean, catalogue: readonly PermissionInfo[]): Permission[] {
  const out = new Set(perms)
  const requires = (k: Permission) => catalogue.find((c) => c.key === k)?.requires ?? []
  if (on) {
    const add = (k: Permission) => {
      if (out.has(k)) return
      out.add(k)
      requires(k).forEach(add)
    }
    out.delete(p)
    add(p)
  } else {
    const remove = (k: Permission) => {
      out.delete(k)
      catalogue.filter((c) => out.has(c.key) && c.requires.includes(k)).forEach((c) => remove(c.key))
    }
    remove(p)
  }
  return ordered(out, catalogue)
}

/** The ticked permissions that need p, which keep it ticked. */
export function neededBy(p: Permission, perms: readonly Permission[], catalogue: readonly PermissionInfo[]): Permission[] {
  return catalogue.filter((c) => perms.includes(c.key) && c.requires.includes(p)).map((c) => c.key)
}

/** The catalogue by group, in its order: Administration, Workwear & Equipment, Dashboards. */
export function grouped(catalogue: readonly PermissionInfo[]): { group: PermissionInfo['group']; permissions: PermissionInfo[] }[] {
  const out: { group: PermissionInfo['group']; permissions: PermissionInfo[] }[] = []
  for (const p of catalogue) {
    const last = out.at(-1)
    if (last?.group === p.group) last.permissions.push(p)
    else out.push({ group: p.group, permissions: [p] })
  }
  return out
}

export function permissionLabel(p: Permission): string {
  return t.roles.permission[p].label
}
