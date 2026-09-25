import type { Role, User } from '@ppe/api-client'

import { passwordProblem } from './password'

/**
 * Users screen rules (admin only). The API enforces all of them; these
 * mirror internal/domain/user so the form can say what is wrong before a
 * round trip, and lock what the API would refuse for the admin's own account.
 */

/** Every role, highest first, with what it grants in this app. */
export const roles: { role: Role; label: string; grants: string }[] = [
  { role: 'admin', label: 'Administrator', grants: 'Manages users, plus everything a manager can do.' },
  { role: 'manager', label: 'Manager', grants: 'Manages Item Catalogue prices and Item Sets, plus everything an employee can do.' },
  { role: 'employee', label: 'Employee', grants: 'Prepares orders, manages employees and sizes, uses History.' },
]

export function roleLabel(r: Role): string {
  return roles.find((x) => x.role === r)?.label ?? r
}

/** Roles in the fixed order above, whatever order they were picked in. */
export function sortRoles(picked: readonly Role[]): Role[] {
  return roles.map((x) => x.role).filter((r) => picked.includes(r))
}

export interface UserDraft {
  name: string
  email: string
  roles: Role[]
  isActive: boolean
  /** New users only: an admin reset uses the same two fields. */
  password: string
  confirm: string
}

export type UserErrors = Partial<Record<'name' | 'email' | 'roles' | 'password' | 'confirm', string>>

export function draftOf(u: User | undefined): UserDraft {
  return { name: u?.name ?? '', email: u?.email ?? '', roles: u ? sortRoles(u.roles) : ['employee'], isActive: u?.is_active ?? true, password: '', confirm: '' }
}

/** A bare address, as the API's mail.ParseAddress check accepts it. */
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/

export function validateUser(d: UserDraft, isNew: boolean): UserErrors {
  const errors: UserErrors = {}
  const name = d.name.trim()
  if (!name) errors.name = 'Enter a name.'
  else if (name.length > 200) errors.name = 'Use at most 200 characters.'
  const email = d.email.trim()
  if (!email) errors.email = 'Enter an email address.'
  else if (!EMAIL.test(email) || email.length > 254) errors.email = 'Enter a valid email address, like name@example.com.'
  if (d.roles.length === 0) errors.roles = 'Choose at least one role.'
  if (isNew) Object.assign(errors, validateNewPassword(d.password, d.confirm))
  return errors
}

/** A password set by an admin: for a new user or a reset. */
export function validateNewPassword(password: string, confirm: string): Pick<UserErrors, 'password' | 'confirm'> {
  const problem = passwordProblem(password)
  if (problem) return { password: problem }
  if (confirm !== password) return { confirm: 'The passwords do not match.' }
  return {}
}

/**
 * What an admin may not change on their own account, because the API refuses
 * it: they could lock everyone out of user management.
 */
export function ownAccountLocks(u: User | undefined, sessionUserId: string): { active: boolean; admin: boolean } {
  const own = u?.id === sessionUserId
  return { active: own, admin: own && u.roles.includes('admin') }
}
