/**
 * Where each staff app is mounted on the one origin, so a link from one app
 * to the other is a full page load to the right place. The web server
 * (deploy/Caddyfile), each app's Vite base and these must agree.
 */
export const staffBase = ''
export const adminBase = '/admin'
/** Scan SIMs, the trial app (docs/specs/asset-service.md "Scan SIM cards"), published under App Launcher (ADR 0006): Stable. */
export const simScanBase = '/apps/sim-scan'
/** App Launcher, every app a user's roles open (ADR 0006, docs/specs/app-launcher.md). */
export const launcherBase = '/apps'

/** An address in the staff app, from another app: '/orders' → '/orders'. */
export const staffHref = (path: string) => staffBase + path

/** An address in Administration, from another app: '/users' → '/admin/users'; '/' → '/admin/'. */
export const adminHref = (path: string) => adminBase + path

/** An address in Scan SIMs, from another app: '/' → '/apps/sim-scan/'; '/find' → '/apps/sim-scan/find'. */
export const simScanHref = (path: string) => simScanBase + path

/** An address in App Launcher, from another app: '/' → '/apps/'. */
export const launcherHref = (path: string) => launcherBase + path
