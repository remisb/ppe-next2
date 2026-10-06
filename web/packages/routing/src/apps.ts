/**
 * Where each staff app is mounted on the one origin, so a link from one app
 * to the other is a full page load to the right place. The web server
 * (deploy/Caddyfile), each app's Vite base and these must agree.
 */
export const staffBase = ''
export const adminBase = '/admin'

/** An address in the staff app, from another app: '/orders' → '/orders'. */
export const staffHref = (path: string) => staffBase + path

/** An address in Administration, from another app: '/users' → '/admin/users'; '/' → '/admin/'. */
export const adminHref = (path: string) => adminBase + path
