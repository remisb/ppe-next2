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
  editDescription: (users: number) =>
    users === 0
      ? 'No one holds this role yet.'
      : plural(users, { one: 'A change reaches the # user who holds this role, within minutes.', other: 'A change reaches the # users who hold this role, within minutes.' }),
  // Asked first when a permission is taken away from people who hold the role.
  confirmRemovePermissions: (permissions: number, users: number) =>
    `${plural(permissions, { one: 'Take # permission', other: 'Take # permissions' })} away from ${plural(users, { one: '# user', other: '# users' })}? They can no longer do what it allows, unless another of their roles allows it.`,
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
    launcher: 'App Launcher',
    workwear: 'Workwear & Equipment',
    personnel: 'Personnel files',
    dashboards: 'Dashboards',
  } satisfies Record<PermissionInfo['group'], string>,
  permission: {
    'users.read': { label: 'See users', grants: 'List users and the roles each holds.' },
    'users.manage': {
      label: 'Manage users',
      grants: 'Add, edit, deactivate and delete users, reset their passwords and give them roles.',
    },
    'roles.manage': { label: 'Manage roles', grants: 'Add, change and delete roles, and give any permission.' },
    'settings.manage': { label: 'Change Settings', grants: 'The company, the supplier’s WhatsApp group and the SIM providers.' },
    'mail_templates.manage': { label: 'Change Mail Templates', grants: 'The text of the emails the app prepares, such as the SIM activation and blocking emails.' },
    'backups.read': { label: 'See Backups', grants: 'Whether the database is backed up, and the recent backups.' },
    'audit.read': { label: 'See the Audit log', grants: 'Every recorded change, who made it and when, across all records.' },
    'audit.export': {
      label: 'Export the Audit log',
      grants: 'Download the changes the filters select, a year at most, as CSV or JSON lines. Each export is recorded.',
    },
    'security.read': {
      label: 'See Security',
      grants: 'Sign-ins and failed attempts with their addresses, everyone’s signed-in devices, and the access review.',
    },
    'system.read': {
      label: 'See System',
      grants: 'The API’s state and requests, the database, and the error list with each error’s reference.',
    },
    'usage.read': {
      label: 'See Usage',
      grants: 'Who uses the apps and from what, sign-ins and changes over time, the confirmation-link funnel and data quality.',
    },
    'ai_usage.read': { label: 'See AI Usage', grants: 'Every call the app made to an AI model (the colour photo), its tokens and cost, who and when.' },
    'apps.manage': { label: 'Manage apps', grants: 'App Launcher’s apps and shortcuts: register them, change them, who sees each, their order, and feedback on them.' },
    'apps.preview': { label: 'See apps in testing', grants: 'POC and In development apps in App Launcher, behind Show apps in testing.' },
    'employee_profiles.read': {
      label: 'See employee profiles',
      grants: 'An employee’s code, notes, preferred language and photos, and the birth date, nationality and sex from an identity document. Names are everyone’s.',
    },
    'employee_profiles.manage': {
      label: 'Manage employee profiles',
      grants: 'Add New Employee, edit an employee’s name, code, notes and language, and add, change and remove their photos. Needs See employee profiles.',
    },
    'employee_sizes.read': {
      label: 'See employee sizes',
      grants: 'An employee’s height, clothing and shoe size, and who is missing one. Create Order still uses them without it.',
    },
    'employee_sizes.manage': {
      label: 'Manage employee sizes',
      grants: 'Edit Sizes, the sizes on Add New Employee and Edit, and Save as Employee Default in Create Order. Needs See employee sizes.',
    },
    'employees.delete': { label: 'Delete employees', grants: 'Their orders and records stay.' },
    'employees.merge': {
      label: 'Merge employees',
      grants: 'Make one person’s two records one: their orders, company assets and photos move to the record kept. Needs Manage employee profiles and Manage employee sizes.',
    },
    'catalogue.manage': {
      label: 'Manage Item Catalogue',
      grants: 'Add and edit items and their service periods; deactivate and delete them. Prices take Change Item prices.',
    },
    'item_prices.manage': { label: 'Change Item prices', grants: 'Set and change an item’s price and purchase price.' },
    'item_sets.read': {
      label: 'See Item Sets',
      grants: 'The Item Sets screen, and which sets hold an item. Create Order offers the active sets to everyone.',
    },
    'item_sets.manage': { label: 'Manage Item Sets', grants: 'Add, edit and delete item sets.' },
    'orders.delete': { label: 'Delete orders', grants: 'Remove demo and test orders; the record and its history stay.' },
    'assets.manage': {
      label: 'Manage Equipment & Furniture',
      grants: 'Add equipment and furniture, give items to employees and register their return. Also needs See Equipment & Furniture.',
    },
    'sim_cards.read': {
      label: 'See SIM Cards',
      grants: 'The SIM Cards screen, each SIM and who holds it: on employee pages, in search and on the dashboards. Without it, SIMs are hidden.',
    },
    'sim_cards.manage': {
      label: 'Manage SIMs',
      grants: 'Add and scan SIMs, edit them, change their status, give them to employees, register their return and prepare their emails. Needs See SIM Cards.',
    },
    'sim_codes.read': {
      label: 'Show PIN and PUK',
      grants: 'See a SIM’s PIN and PUK, after confirming the password; each time is recorded. Needs See SIM Cards.',
    },
    'equipment.read': {
      label: 'See Equipment & Furniture',
      grants: 'Each item and who holds it: in Company Assets, on employee pages and in search. Without it, not even an administrator sees them.',
    },
    'personnel.documents.read': {
      label: 'See identity documents',
      grants: 'A person’s identity documents on their page, and Show Document: the number, personal code and copies, after Confirm your password. Each showing is recorded.',
    },
    'personnel.documents.manage': {
      label: 'Import identity documents',
      grants: 'Scan and save passports and ID cards in Import Documents, add or update the employee, Mark Employment Ended and Legal Hold.',
    },
    'personnel.portraits.colorize': {
      label: 'Make AI colour photos',
      grants: 'Colour a document’s portrait with AI (OpenAI), with the person’s consent. Each use is counted in AI Usage.',
    },
    'dashboard.overview': { label: 'Dashboard', grants: 'Spending, orders waiting and setup gaps.' },
    'dashboard.manager': { label: 'Manager Dashboard', grants: 'Items, prices and purchasing.' },
    'dashboard.employee': { label: 'Employee Dashboard', grants: 'The user’s own orders and what to order next.' },
  } satisfies Record<Permission, { label: string; grants: string }>,
}

export type RolesText = typeof roles
