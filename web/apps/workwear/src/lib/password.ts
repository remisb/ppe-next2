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

export function validatePasswordChange(p: PasswordChange): PasswordErrors {
  const errors: PasswordErrors = {}
  if (!p.current) errors.current = 'Enter your current password.'
  if (p.next.length < MIN_PASSWORD_LENGTH) {
    errors.next = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  } else if (new TextEncoder().encode(p.next).length > MAX_PASSWORD_BYTES) {
    errors.next = 'That password is too long.'
  } else if (p.next === p.current) {
    errors.next = 'Choose a password different from the current one.'
  }
  if (!errors.next && p.confirm !== p.next) errors.confirm = 'The passwords do not match.'
  return errors
}
