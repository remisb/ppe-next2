import type { Role, User } from '@ppe/api-client'

import { t } from '@/i18n'

import { passwordProblem } from './password'

/**
 * Users screen rules (admin only). The API enforces all of them; these
 * mirror internal/domain/user so the form can say what is wrong before a
 * round trip, and lock what the API would refuse for the admin's own account.
 */

/** Every role, highest first. */
export const roleOrder: readonly Role[] = ['admin', 'manager', 'employee']

/** Every role, highest first, with what it grants in this app, in the current language. */
export function roles(): { role: Role; label: string; grants: string }[] {
  return [
    { role: 'admin', label: t.users.admin, grants: t.users.adminGrants },
    { role: 'manager', label: t.users.manager, grants: t.users.managerGrants },
    { role: 'employee', label: t.users.employee, grants: t.users.employeeGrants },
  ]
}

export function roleLabel(r: Role): string {
  return roles().find((x) => x.role === r)?.label ?? r
}

/** Roles in the fixed order above, whatever order they were picked in. */
export function sortRoles(picked: readonly Role[]): Role[] {
  return roleOrder.filter((r) => picked.includes(r))
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
  if (!name) errors.name = t.users.enterName
  else if (name.length > 200) errors.name = t.users.nameTooLong
  const email = d.email.trim()
  if (!email) errors.email = t.users.enterEmail
  else if (!EMAIL.test(email) || email.length > 254) errors.email = t.users.invalidEmail
  if (d.roles.length === 0) errors.roles = t.users.chooseRole
  if (isNew) Object.assign(errors, validateNewPassword(d.password, d.confirm))
  return errors
}

/** A password set by an admin: for a new user or a reset. */
export function validateNewPassword(password: string, confirm: string): Pick<UserErrors, 'password' | 'confirm'> {
  const problem = passwordProblem(password)
  if (problem) return { password: problem }
  if (confirm !== password) return { confirm: t.account.noMatch }
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
