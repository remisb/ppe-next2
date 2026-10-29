/**
 * Where each staff app is mounted on the one origin, so a link from one app
 * to the other is a full page load to the right place. The web server
 * (deploy/Caddyfile), each app's Vite base and these must agree.
 */
export const staffBase = ''
export const adminBase = '/admin'
/** Scan SIMs, the trial app (docs/specs/asset-service.md "Scan SIM cards"). */
export const simScanBase = '/sim-scan'

/** An address in the staff app, from another app: '/orders' → '/orders'. */
export const staffHref = (path: string) => staffBase + path

/** An address in Administration, from another app: '/users' → '/admin/users'; '/' → '/admin/'. */
export const adminHref = (path: string) => adminBase + path

/** An address in Scan SIMs, from another app: '/' → '/sim-scan/'; '/find' → '/sim-scan/find'. */
export const simScanHref = (path: string) => simScanBase + path
