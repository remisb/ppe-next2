/**
 * Every kind of security event the API records, in the Security screen
 * filter's order. They mirror Kinds() in internal/security (events.go); a Go
 * test there reads this file and fails when they differ. The apps' words are
 * typed against this list.
 */
export const SECURITY_KINDS = [
  'sign_in',
  'sign_in_failed',
  'reauth',
  'reauth_failed',
  'signed_out',
  'session_ended',
  'refresh_reused',
] as const

/** One kind of security event. */
export type SecurityKind = (typeof SECURITY_KINDS)[number]

/**
 * Why a sign-in failed, or why a session ended. Reasons the app does not know
 * yet are shown as they are.
 */
export const SECURITY_REASONS = [
  'unknown_email',
  'bad_password',
  'inactive',
  'too_many_attempts',
  'signed_out',
  'ended_elsewhere',
  'ended_by_administrator',
  'password_changed',
  'password_reset',
  'deactivated',
  'deleted',
  'reused',
] as const

export type SecurityReason = (typeof SECURITY_REASONS)[number]

export function isSecurityKind(v: unknown): v is SecurityKind {
  return typeof v === 'string' && (SECURITY_KINDS as readonly string[]).includes(v)
}

export function isSecurityReason(v: unknown): v is SecurityReason {
  return typeof v === 'string' && (SECURITY_REASONS as readonly string[]).includes(v)
}

/** What the access review points out about a user. */
export const ACCESS_FLAGS = ['administrator', 'no_sign_in', 'dormant'] as const

export type AccessFlag = (typeof ACCESS_FLAGS)[number]
