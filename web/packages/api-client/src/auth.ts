import { type Permission, isPermission } from './permissions.ts'

export interface TokenClaims {
  sub: string
  /** What the user's roles allow, when the token was issued. */
  perms: Permission[]
  /** Seconds since the epoch. */
  exp: number
}

/**
 * Read the claims of a JWT without verifying it. The server verifies every
 * request; this only lets the UI show the right controls and notice expiry.
 * Permission keys this client does not know are dropped.
 */
export function decodeToken(token: string): TokenClaims | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const claims: unknown = JSON.parse(json)
    if (
      typeof claims !== 'object' || claims === null ||
      typeof (claims as TokenClaims).sub !== 'string' ||
      typeof (claims as TokenClaims).exp !== 'number'
    ) {
      return null
    }
    const raw: unknown = (claims as { perms?: unknown }).perms
    const perms = Array.isArray(raw) ? raw.filter(isPermission) : []
    return { sub: (claims as TokenClaims).sub, exp: (claims as TokenClaims).exp, perms }
  } catch {
    return null
  }
}

export function isTokenExpired(claims: TokenClaims, now: number = Date.now()): boolean {
  return claims.exp * 1000 <= now
}
