/**
 * What the page says about itself: the API names a published app's mount, its
 * files' address, version and channel in meta tags of the index.html it
 * answers (ADR 0006, phase 3; cmd/api/published-app-routes.go). Null in an app
 * on a fixed address, and in development.
 */
function meta(name: string): string | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null
}

/**
 * The prefix the app is served under, without a trailing slash: '' at the
 * origin root, '/app' under a path. A published app's is its channel's or
 * version's address; any other's Vite's BASE_URL, so the router and the
 * bundle's asset URLs cannot disagree.
 */
export const basePath: string = (meta('ppe-mount') ?? import.meta.env.BASE_URL).replace(/\/+$/, '')

/** Where the app's own files are, with a trailing slash: a published version's folder, else BASE_URL. */
export const filesBase: string = meta('ppe-files') ?? import.meta.env.BASE_URL

/** A published app's version (YYYY.MM.DD-<commit>), else null. */
export const appVersion: string | null = meta('ppe-version')

/** The channel a published app was opened on: stable, beta, preview, a variant's name, or "@<version>"; else null. */
export const appChannel: string | null = meta('ppe-channel')

/**
 * Strip the mount prefix so '/app/employees' parses as '/employees'. The bare
 * prefix is the root, a path without the prefix passes through unchanged, and
 * a longer sibling ('/application') is not a prefix match.
 */
export function stripBase(pathname: string, base: string = basePath): string {
  if (!base) return pathname
  if (pathname === base) return '/'
  return pathname.startsWith(base + '/') ? pathname.slice(base.length) : pathname
}
