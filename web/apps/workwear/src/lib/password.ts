/**
 * Client-side checks for Change password, mirroring the API's rules
 * (internal/domain/user): 8–72 bytes. The upper bound is bytes, not
 * characters, because bcrypt ignores input past 72 bytes; the server rejects
 * rather than truncates.
 */
import { t } from '@/i18n'

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_BYTES = 72

export interface PasswordChange {
  current: string
  next: string
  confirm: string
}

export type PasswordErrors = Partial<Record<keyof PasswordChange, string>>

/** The length rule alone, for any new password: own change, a new user, an admin reset. */
export function passwordProblem(pw: string): string | undefined {
  if (pw.length < MIN_PASSWORD_LENGTH) return t.account.useAtLeast(MIN_PASSWORD_LENGTH)
  if (new TextEncoder().encode(pw).length > MAX_PASSWORD_BYTES) return t.account.tooLong
  return undefined
}

export function validatePasswordChange(p: PasswordChange): PasswordErrors {
  const errors: PasswordErrors = {}
  if (!p.current) errors.current = t.account.enterCurrent
  const problem = passwordProblem(p.next)
  if (problem) {
    errors.next = problem
  } else if (p.next === p.current) {
    errors.next = t.account.chooseDifferent
  }
  if (!errors.next && p.confirm !== p.next) errors.confirm = t.account.noMatch
  return errors
}
