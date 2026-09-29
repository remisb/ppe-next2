/** The Users screen (administrators only). Password rules come from account. */
export const users = {
  title: 'Users',
  onlyAdmins: 'Only administrators can manage users.',
  description: 'Who can sign in, and what they may do. Inactive users cannot sign in; their past work keeps their name.',
  addUser: 'Add User',
  searchPlaceholder: 'Search by name or email',
  searchLabel: 'Search users',
  noMatch: (q: string) => `No users match “${q}”.`,
  noUsers: 'No users yet.',
  name: 'Name',
  email: 'Email',
  roles: 'Roles',
  status: 'Status',
  actions: 'Actions',
  you: 'You',
  editUserLabel: (name: string) => `Edit ${name}`,
  resetPassword: 'Reset password…',

  // Roles, highest first, with what each grants
  admin: 'Administrator',
  adminGrants: 'Manages users, plus everything a manager can do.',
  manager: 'Manager',
  managerGrants: 'Manages Item Catalogue prices and Item Sets, plus everything an employee can do.',
  employee: 'Employee',
  employeeGrants: 'Prepares orders, manages employees and sizes, uses History.',

  // Add User / Edit User
  editUser: (name: string) => `Edit User: ${name}`,
  editDescription: 'A role change applies from the user’s next sign-in.',
  addDescription: 'They sign in with this email and password, and can change the password under Account.',
  /** Follows the admin role's description on the admin's own account. */
  adminLocked: ' You cannot remove it from your own account.',
  password: 'Password',
  confirmPassword: 'Confirm password',
  cannotDeactivateOwn: 'You cannot deactivate your own account.',
  inactiveExplained: 'An inactive user cannot sign in. A token they already hold lasts until it expires.',
  enterName: 'Enter a name.',
  nameTooLong: 'Use at most 200 characters.',
  enterEmail: 'Enter an email address.',
  invalidEmail: 'Enter a valid email address, like name@example.com.',
  chooseRole: 'Choose at least one role.',
  emailTaken: 'Another user already has this email address.',

  // Reset password
  resetTitle: (name: string) => `Reset password: ${name}`,
  resetDescription: 'Give them the new password in person or by phone, not in a chat. They can change it under Account.',
  done: 'Done',
  setPassword: 'Set password',
  passwordChangedFor: (name: string) => `The password for ${name} has been changed.`,
}

export type UsersText = typeof users
