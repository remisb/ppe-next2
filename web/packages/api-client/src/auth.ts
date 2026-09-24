import type { Role } from './types.ts'

export interface TokenClaims {
  sub: string
  roles: Role[]
  /** Seconds since the epoch. */
  exp: number
}

/**
 * Read the claims of a JWT without verifying it. The server verifies every
 * request; this only lets the UI show the right controls and notice expiry.
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
    const roles = Array.isArray((claims as TokenClaims).roles) ? (claims as TokenClaims).roles : []
    return { sub: (claims as TokenClaims).sub, exp: (claims as TokenClaims).exp, roles }
  } catch {
    return null
  }
}

export function isTokenExpired(claims: TokenClaims, now: number = Date.now()): boolean {
  return claims.exp * 1000 <= now
}

export function hasAnyRole(roles: readonly Role[], ...wanted: Role[]): boolean {
  return wanted.some((r) => roles.includes(r))
}
