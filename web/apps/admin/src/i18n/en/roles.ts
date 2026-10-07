import type { Permission, PermissionInfo } from '@ppe/api-client'
import { plural } from '@ppe/i18n'

/** Roles & permissions: what each role allows. Keyed by permission, so a new one without words fails the typecheck. */
export const roles = {
  title: 'Roles & permissions',
  description: 'What each role allows. A user may do what any of their roles allows; give roles to users on Users.',
  onlyRoleManagers: 'Only users who manage roles can change them.',
  addRole: 'Add Role',
  name: 'Name',
  descriptionLabel: 'Description',
  permissions: 'Permissions',
  users: 'Users',
  actions: 'Actions',
  builtIn: 'Built-in',
  usersCount: (n: number) => plural(n, { one: '# user', other: '# users' }),
  permissionsCount: (n: number) => plural(n, { one: '# permission', other: '# permissions' }),
  editRoleLabel: (name: string) => `Edit ${name}`,
  viewRoleLabel: (name: string) => `View ${name}`,
  // Add Role / Edit Role
  editRole: (name: string) => `Edit Role: ${name}`,
  viewRole: (name: string) => `Role: ${name}`,
  editDescription: 'A change reaches the users who hold the role within minutes.',
  addDescription: 'Then give it to users on Users.',
  lockedNote: 'Administrator can do everything in Administration and cannot be changed, so someone can always manage users and roles.',
  builtInFixed: 'A built-in role keeps its name and description.',
  neededBy: (names: string) => `Needed by ${names}.`,
  enterName: 'Enter a name.',
  nameTooLong: 'Use at most 100 characters.',
  descriptionTooLong: 'Use at most 500 characters.',
  nameTaken: 'Another role already has this name.',
  // Delete
  deleteRole: 'Delete role…',
  deleteQuestion: (name: string) => `Delete the role ${name}? No user holds it.`,
  inUse: 'Users hold this role. Take it from them on Users first.',
  groups: {
    administration: 'Administration',
    workwear: 'Workwear & Equipment',
    dashboards: 'Dashboards',
  } satisfies Record<PermissionInfo['group'], string>,
  permission: {
    'users.read': { label: 'See users', grants: 'List users and the roles each holds.' },
    'users.manage': {
      label: 'Manage users',
      grants: 'Add, edit, deactivate and delete users, reset their passwords and give them roles.',
    },
    'roles.manage': { label: 'Manage roles', grants: 'Add, change and delete roles, and give any permission.' },
    'settings.manage': { label: 'Change Settings', grants: 'The supplier’s WhatsApp group.' },
    'backups.read': { label: 'See Backups', grants: 'Whether the database is backed up, and the recent backups.' },
    'audit.read': { label: 'See the Audit log', grants: 'Every recorded change, who made it and when, across all records.' },
    'employees.delete': { label: 'Delete employees', grants: 'Their orders and records stay.' },
    'catalogue.manage': {
      label: 'Manage Item Catalogue',
      grants: 'Add and edit items, their prices and service periods; deactivate and delete them.',
    },
    'item_sets.manage': { label: 'Manage Item Sets', grants: 'Add, edit and delete item sets.' },
    'orders.delete': { label: 'Delete orders', grants: 'Remove demo and test orders; the record and its history stay.' },
    'dashboard.overview': { label: 'Dashboard', grants: 'Spending, orders waiting and setup gaps.' },
    'dashboard.manager': { label: 'Manager Dashboard', grants: 'Items, prices and purchasing.' },
    'dashboard.employee': { label: 'Employee Dashboard', grants: 'The user’s own orders and what to order next.' },
  } satisfies Record<Permission, { label: string; grants: string }>,
}

export type RolesText = typeof roles
