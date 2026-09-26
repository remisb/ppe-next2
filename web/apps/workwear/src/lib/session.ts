import { type Role, decodeToken, hasAnyRole, isTokenExpired } from '@ppe/api-client'

// sessionStorage: tokens live 15 minutes and cannot be revoked, so they should
// not outlive the tab.
const TOKEN_KEY = 'workwear.token'

export interface Session {
  token: string
  userId: string
  name: string
  roles: readonly Role[]
  /** "Manage Items and Prices": catalogue and item sets. */
  canManageItems: boolean
  /** Administrators manage user accounts (the Users screen). */
  canManageUsers: boolean
  /** Administrators start on the Dashboard, which only they can see. */
  isAdmin: boolean
  /** Managers have their own dashboard, which only they can see. */
  isManager: boolean
}

export function sessionFromToken(token: string, name: string): Session | null {
  const claims = decodeToken(token)
  if (!claims || isTokenExpired(claims)) return null
  return {
    token,
    userId: claims.sub,
    name,
    roles: claims.roles,
    canManageItems: hasAnyRole(claims.roles, 'admin', 'manager'),
    canManageUsers: hasAnyRole(claims.roles, 'admin'),
    isAdmin: hasAnyRole(claims.roles, 'admin'),
    isManager: hasAnyRole(claims.roles, 'manager'),
  }
}

interface Stored {
  token: string
  name: string
}

export function loadSession(): Session | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(TOKEN_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Stored
    const session = sessionFromToken(s.token, s.name)
    if (!session) clearSession()
    return session
  } catch {
    return null
  }
}

export function storeSession(s: Session): void {
  try {
    globalThis.sessionStorage?.setItem(TOKEN_KEY, JSON.stringify({ token: s.token, name: s.name } satisfies Stored))
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
