// Settings shared by the Playwright config and global setup. The suite owns
// its database: it is emptied before every run, so never point it at dev data.
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export const dbDSN = process.env['E2E_DB_DSN'] ?? process.env['API_TEST_DB_DSN'] ?? 'postgres://ppe2:ppe2@localhost:5442/ppe2_test?sslmode=disable'
export const apiPort = 18090
export const webPort = 5181
/** Administration's Vite server; the staff app's proxies /admin to it, so tests open it at webURL/admin/. */
export const adminPort = 5183
export const webURL = `http://localhost:${webPort}`

// A test-only account created by global setup; not a real credential.
export const admin = { email: 'e2e-admin@example.com', password: 'e2e-password-123', name: 'E2E Admin' }

/**
 * The API connects as the least-privilege role ppe_app (migration 0026), as
 * production does, so every step exercises its grants; setup (prepareDatabase)
 * gives it this test-only password. Setup itself connects as the owner.
 */
const appPassword = 'e2e-app-password'

export function appDSN(): string {
  const u = new URL(dbDSN)
  u.username = 'ppe_app'
  u.password = appPassword
  return u.toString()
}

/**
 * Empties the test database (the trails' TRUNCATE guard asks for the flag)
 * and lets ppe_app sign in with the test password.
 */
export async function prepareDatabase(query: (sql: string) => Promise<unknown>, ...more: string[]): Promise<void> {
  await query(
    `BEGIN; SET LOCAL ppe.allow_truncate = on; TRUNCATE users, audit_seals, audit_purges, asset_number_counters CASCADE; ${more.join('; ')}${more.length ? ';' : ''} COMMIT`,
  )
  await allowAppRole(query)
}

/** Lets ppe_app sign in with the test password. */
export async function allowAppRole(query: (sql: string) => Promise<unknown>): Promise<void> {
  await query(`ALTER ROLE ppe_app WITH LOGIN PASSWORD '${appPassword}'`)
}

/** Environment for the API process under test. */
export function apiEnv(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    API_ADDR: `:${apiPort}`,
    API_DB_DSN: appDSN(),
    API_JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
    API_JWT_TTL: '1h',
    API_PUBLIC_BASE_URL: webURL,
    API_ORG_TIMEZONE: 'Europe/Vilnius',
    API_LOGIN_RATE_LIMIT: '100',
    // As deployed behind Caddy; harmless with the Vite proxy.
    API_TRUSTED_PROXIES: '127.0.0.1,::1',
    API_SEED_USER_EMAIL: admin.email,
    API_SEED_USER_PASSWORD: admin.password,
    API_SEED_USER_NAME: admin.name,
    // Signed copies go to a folder of the run's own, as a Spaces bucket would keep them.
    API_FILES_TARGET: `file://${join(tmpdir(), 'ppe-next2-e2e-files')}`,
  }
}
