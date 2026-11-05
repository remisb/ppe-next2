/**
 * App Launcher's rule for a tile's slug, also a variant's name: the API's
 * launcher.slugPattern and launcher.ReservedSlugs, which a Go test
 * (TestWebClientKeepsTheSlugRule) keeps equal to these. Read by Manage apps
 * and make new-app (by path, so this file imports nothing).
 */
export const APP_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,30}$/

/** App Launcher's own paths under /apps/ (deploy/Caddyfile serves them): never an app's slug. */
export const RESERVED_APP_SLUGS: readonly string[] = ['assets', 'files']
