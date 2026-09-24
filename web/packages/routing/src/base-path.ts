/**
 * The prefix the app is served under, without a trailing slash: '' at the
 * origin root, '/app' under a path. Read from Vite's BASE_URL so the router and
 * the bundle's asset URLs cannot disagree.
 */
export const basePath: string = import.meta.env.BASE_URL.replace(/\/+$/, '')

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
