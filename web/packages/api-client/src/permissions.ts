/**
 * The permission catalogue, in the order Roles & permissions lists it. It
 * mirrors Catalogue() in internal/domain/role/permission.go; a Go test there
 * reads this file and fails when the two differ.
 */
export const PERMISSIONS = [
  'users.read',
  'users.manage',
  'roles.manage',
  'settings.manage',
  'backups.read',
  'audit.read',
  'audit.export',
  'security.read',
  'system.read',
  'usage.read',
  'employees.delete',
  'catalogue.manage',
  'item_sets.manage',
  'orders.delete',
  'assets.manage',
  'equipment.read',
  'dashboard.overview',
  'dashboard.manager',
  'dashboard.employee',
] as const

/** One thing a role may allow; a route requires one. */
export type Permission = (typeof PERMISSIONS)[number]

export function isPermission(key: unknown): key is Permission {
  return typeof key === 'string' && (PERMISSIONS as readonly string[]).includes(key)
}
