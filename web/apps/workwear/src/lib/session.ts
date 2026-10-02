import { type Role, decodeToken, hasAnyRole, isTokenExpired } from '@ppe/api-client'

import { type Lang, isLang } from '@/i18n'

// sessionStorage: tokens live 15 minutes and cannot be revoked, so they should
// not outlive the tab. While the tab is open the app refreshes them (refreshDue).
const TOKEN_KEY = 'workwear.token'

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
  roles: readonly Role[]
  /** "Manage Items and Prices": catalogue and item sets. */
  canManageItems: boolean
  /** Administrators manage user accounts (the Users screen). */
  canManageUsers: boolean
  /** Administrators start on the Dashboard, which only they can see. */
  isAdmin: boolean
  /** Managers have their own dashboard, which only they can see. */
  isManager: boolean
  /** So do users with the employee role, who prepare orders. */
  isEmployee: boolean
}

export function sessionFromToken(token: string, name: string, language: Lang = 'en'): Session | null {
  const claims = decodeToken(token)
  if (!claims || isTokenExpired(claims)) return null
  return {
    token,
    userId: claims.sub,
    name,
    language,
    roles: claims.roles,
    canManageItems: hasAnyRole(claims.roles, 'admin', 'manager'),
    canManageUsers: hasAnyRole(claims.roles, 'admin'),
    isAdmin: hasAnyRole(claims.roles, 'admin'),
    isManager: hasAnyRole(claims.roles, 'manager'),
    isEmployee: hasAnyRole(claims.roles, 'employee'),
  }
}

interface Stored {
  token: string
  name: string
  language?: string
}

export function loadSession(): Session | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(TOKEN_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Stored
    const session = sessionFromToken(s.token, s.name, isLang(s.language) ? s.language : 'en')
    if (!session) clearSession()
    return session
  } catch {
    return null
  }
}

export function storeSession(s: Session): void {
  try {
    globalThis.sessionStorage?.setItem(TOKEN_KEY, JSON.stringify({ token: s.token, name: s.name, language: s.language } satisfies Stored))
  } catch {
    // The session still works in memory for this tab.
  }
}

export function clearSession(): void {
  try {
    globalThis.sessionStorage?.removeItem(TOKEN_KEY)
  } catch {
    // Nothing to clear.
  }
}
