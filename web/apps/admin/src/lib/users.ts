import type { Permission, Role, User } from '@ppe/api-client'
import { passwordProblem } from '@ppe/app-shell'

import { t } from '@/i18n'

/**
 * Users screen rules. The API enforces all of them; these mirror
 * internal/domain/user so the form can say what is wrong before a round
 * trip, and lock what the API would refuse on the user's own account.
 */

/** A role as people read it: a built-in one in the language in use, one an administrator added by its own name. */
export function roleName(r: Pick<Role, 'key' | 'name'>): string {
  switch (r.key) {
    case 'admin':
      return t.users.admin
    case 'manager':
      return t.users.manager
    case 'employee':
      return t.users.employee
    case 'equipment':
      return t.users.equipment
    default:
      return r.name
  }
}

/** What a role is for: a built-in one's grants in the language in use, else its own description. */
export function roleGrants(r: Role): string {
  switch (r.key) {
    case 'admin':
      return t.users.adminGrants
    case 'manager':
      return t.users.managerGrants
    case 'employee':
      return t.users.employeeGrants
    case 'equipment':
      return t.users.equipmentGrants
    default:
      return r.description
  }
}

/** The roles ids name, in the roles list's order (the built-ins first, highest first). */
export function rolesOf(ids: readonly string[], all: readonly Role[]): Role[] {
  return all.filter((r) => ids.includes(r.id))
}

/** For sorting users by their most powerful role: the place of their first role in the list. */
export function roleRank(u: User, all: readonly Role[]): number {
  const i = all.findIndex((r) => u.role_ids.includes(r.id))
  return i < 0 ? all.length : i
}

export interface UserDraft {
  name: string
  email: string
  roleIds: string[]
  isActive: boolean
  /** New users only: an admin reset uses the same two fields. */
  password: string
  confirm: string
}

export type UserErrors = Partial<Record<'name' | 'email' | 'roles' | 'password' | 'confirm', string>>

/** The form for u, or a new user, who starts with the built-in Employee role. */
export function draftOf(u: User | undefined, all: readonly Role[]): UserDraft {
  const employee = all.find((r) => r.key === 'employee')
  const roleIds = u ? rolesOf(u.role_ids, all).map((r) => r.id) : employee ? [employee.id] : []
  return { name: u?.name ?? '', email: u?.email ?? '', roleIds, isActive: u?.is_active ?? true, password: '', confirm: '' }
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
  if (d.roleIds.length === 0) errors.roles = t.users.chooseRole
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

/** What no one may take from themselves: they could lock everyone out of managing users and roles. */
const kept: readonly Permission[] = ['users.manage', 'roles.manage']

/**
 * What a user may not change on their own account, because the API refuses
 * it: deactivating it, and unticking a role that alone gives them managing
 * users or roles.
 */
export function ownAccountLocks(u: User | undefined, sessionUserId: string, all: readonly Role[]): { active: boolean; roleIds: string[] } {
  if (!u || u.id !== sessionUserId) return { active: false, roleIds: [] }
  const held = rolesOf(u.role_ids, all)
  const locked = held.filter((r) => {
    const others = held.filter((o) => o.id !== r.id).flatMap((o) => o.permissions)
    return kept.some((p) => r.permissions.includes(p) && !others.includes(p))
  })
  return { active: true, roleIds: locked.map((r) => r.id) }
}
