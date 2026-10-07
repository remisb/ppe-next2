import { type Permission, decodeToken, isTokenExpired } from '@ppe/api-client'
import type { Lang } from '@ppe/i18n'

/*
 * The sign-in lives in an HttpOnly refresh cookie that the server sets and no
 * script can read; the access token, valid for minutes, lives only in memory.
 * Each tab gets its own from the cookie when it opens (lib/api.tsx), so a
 * reload, a new tab or a device that slept stays signed in, and nothing an
 * injected script could take is stored.
 */

/**
 * A token with less than this left is refreshed: for the 15-minute token, once
 * it is 5 minutes old, so about every 5 minutes while the app is open.
 */
export const REFRESH_WHEN_LEFT_MS = 10 * 60_000

/** Whether token should be swapped for a new one now (also true once it has expired). */
export function refreshDue(token: string, now: number = Date.now()): boolean {
  const claims = decodeToken(token)
  return claims !== null && claims.exp * 1000 - now < REFRESH_WHEN_LEFT_MS
}

export interface Session {
  token: string
  userId: string
  name: string
  /** The user's interface language, from their account. */
  language: Lang
  /** What the user's roles allow, from the token. The server checks every request; this only picks the controls shown. */
  permissions: ReadonlySet<Permission>
  /** Whether the user's roles allow p. */
  can: (p: Permission) => boolean
}

export function sessionFromToken(token: string, name: string, language: Lang = 'en'): Session | null {
  const claims = decodeToken(token)
  if (!claims || isTokenExpired(claims)) return null
  const permissions: ReadonlySet<Permission> = new Set(claims.perms)
  return { token, userId: claims.sub, name, language, permissions, can: (p) => permissions.has(p) }
}

/** The permissions that open a screen in Administration (the admin app). */
export const ADMINISTRATION_PERMISSIONS: readonly Permission[] = ['users.manage', 'roles.manage', 'settings.manage', 'backups.read', 'audit.read']

/** Whether the user may open any of Administration's screens, so the staff app links there. */
export function canAdminister(s: Pick<Session, 'can'>): boolean {
  return ADMINISTRATION_PERMISSIONS.some((p) => s.can(p))
}

/** Where the app kept the token before sign-ins moved to a cookie; cleared at start-up. */
const LEGACY_TOKEN_KEY = 'workwear.token'

export function clearLegacyToken(): void {
  try {
    globalThis.sessionStorage?.removeItem(LEGACY_TOKEN_KEY)
  } catch {
    // Nothing to clear.
  }
}

const KEEP_KEY = 'workwear.keepSignedIn'

/**
 * Whether Keep me signed in starts ticked on this device: yes, unless it was
 * unticked at the last sign-in here (a shared device stays unticked).
 */
export function keepSignedInChoice(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEEP_KEY) !== 'false'
  } catch {
    return true
  }
}

export function rememberKeepSignedIn(keep: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEEP_KEY, String(keep))
  } catch {
    // The box starts ticked next time.
  }
}

/**
 * Runs refresh with the browser's lock on it where there is one (Web Locks), so
 * tabs refreshing at the same moment take turns: each sends the cookie the one
 * before it received. The server also tolerates the replaced cookie for a
 * moment, so a browser without locks is only less tidy.
 */
export function withRefreshLock<T>(refresh: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  return locks ? locks.request('workwear.refresh', refresh) : refresh()
}
