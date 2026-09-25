// Settings shared by the Playwright config and global setup. The suite owns
// its database: it is emptied before every run, so never point it at dev data.
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export const dbDSN = process.env['E2E_DB_DSN'] ?? process.env['API_TEST_DB_DSN'] ?? 'postgres://ppe2:ppe2@localhost:5442/ppe2_test?sslmode=disable'
export const apiPort = 18090
export const webPort = 5181
export const webURL = `http://localhost:${webPort}`

// A test-only account created by global setup; not a real credential.
export const admin = { email: 'e2e-admin@example.com', password: 'e2e-password-123', name: 'E2E Admin' }

/** Environment for the API process under test. */
export function apiEnv(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    API_ADDR: `:${apiPort}`,
    API_DB_DSN: dbDSN,
    API_JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
    API_JWT_TTL: '1h',
    API_PUBLIC_BASE_URL: webURL,
    API_ORG_TIMEZONE: 'Europe/Vilnius',
    API_LOGIN_RATE_LIMIT: '100',
    API_SEED_USER_EMAIL: admin.email,
    API_SEED_USER_PASSWORD: admin.password,
    API_SEED_USER_NAME: admin.name,
  }
}
