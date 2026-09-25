/**
 * Client-side checks for Change password, mirroring the API's rules
 * (internal/domain/user): 8–72 bytes. The upper bound is bytes, not
 * characters, because bcrypt ignores input past 72 bytes; the server rejects
 * rather than truncates.
 */
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
  if (pw.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (new TextEncoder().encode(pw).length > MAX_PASSWORD_BYTES) return 'That password is too long.'
  return undefined
}

export function validatePasswordChange(p: PasswordChange): PasswordErrors {
  const errors: PasswordErrors = {}
  if (!p.current) errors.current = 'Enter your current password.'
  const problem = passwordProblem(p.next)
  if (problem) {
    errors.next = problem
  } else if (p.next === p.current) {
    errors.next = 'Choose a password different from the current one.'
  }
  if (!errors.next && p.confirm !== p.next) errors.confirm = 'The passwords do not match.'
  return errors
}
