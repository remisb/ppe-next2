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
  'mail_templates.manage',
  'document_templates.manage',
  'suppliers.manage',
  'companies.manage',
  'backups.read',
  'audit.read',
  'audit.export',
  'security.read',
  'system.read',
  'usage.read',
  'ai_usage.read',
  'apps.manage',
  'apps.preview',
  'data.export',
  'employee_profiles.read',
  'employee_profiles.manage',
  'employee_sizes.read',
  'employee_sizes.manage',
  'employees.delete',
  'employees.merge',
  'catalogue.manage',
  'item_prices.manage',
  'item_sets.read',
  'item_sets.manage',
  'orders.delete',
  'assets.manage',
  'sim_cards.read',
  'sim_cards.manage',
  'equipment.read',
  'personnel.documents.read',
  'personnel.documents.manage',
  'personnel.portraits.colorize',
  'vault.read',
  'vault.manage',
  'vault.employment.read',
  'vault.employment.manage',
  'dashboard.overview',
  'dashboard.manager',
  'dashboard.employee',
] as const

/** One thing a role may allow; a route requires one. */
export type Permission = (typeof PERMISSIONS)[number]

export function isPermission(key: unknown): key is Permission {
  return typeof key === 'string' && (PERMISSIONS as readonly string[]).includes(key)
}
