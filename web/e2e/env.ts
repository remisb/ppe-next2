// Settings shared by the Playwright config and global setup. The suite owns
// its database: it is emptied before every run, so never point it at dev data.
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type PublishedApp, fixedApps, publishedApps as findPublishedApps } from '../packages/launcher/src/published-apps.ts'

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export const dbDSN = process.env['E2E_DB_DSN'] ?? process.env['API_TEST_DB_DSN'] ?? 'postgres://ppe2:ppe2@localhost:5442/ppe2_test?sslmode=disable'
/**
 * The test database's lock (internal/db/testlock): a run holds it for its
 * whole length (pnpm e2e runs through cmd/testlock), from a connection whose
 * application_name is "ppe-test-lock <token> <what>"; PPE_TEST_LOCK is this
 * run's token. The Go tests keep the key and the default DSN above equal.
 */
export const testLockKey = 0x50504554
export const apiPort = 18090
// Each app's e2e server takes the port after its dev server's (published-apps.ts' fixedApps).
export const webPort = fixedApps.workwear + 1
/** Administration's Vite server; the staff app's proxies /admin to it, so tests open it at webURL/admin/. */
export const adminPort = fixedApps.admin + 1
/** App Launcher's Vite server; the staff app's proxies /apps to it, so tests open it at webURL/apps/. */
export const launcherPort = fixedApps.launcher + 1
export const webURL = `http://localhost:${webPort}`
/** A fake OpenAI the API calls for the AI colour photo (API_OPENAI_BASE_URL), started by its step. */
export const openAIPort = 18095

/** E2E_WEB_SERVER=caddy: the production bundle behind deploy/Caddyfile, as CI runs it. */
export const caddyMode = process.env['E2E_WEB_SERVER'] === 'caddy'

/**
 * Published apps' builds (API_APPS_DIR, Caddy's PUBLISHED_ROOT) in Caddy mode:
 * Scan SIMs is published there before the run, as a deploy publishes it. With
 * Vite it is its own dev server instead.
 */
export const appsDir = join(tmpdir(), 'ppe-next2-e2e-published')

/**
 * The published apps a run uses (every web/apps/<slug> with a
 * public/ppe-app.json, such as Scan SIMs). With Vite each runs its own server
 * on its e2ePort, which the staff app's proxies /apps/<slug> to; behind Caddy
 * global setup publishes each one's pnpm build, as a deploy does.
 *
 * E2E_APPS=<slug>,… starts (or publishes) only those, and E2E_APPS= none, so a
 * run that needs no published app does not wait for their servers; the steps
 * that need one are skipped (needsApp). Unset: all of them.
 */
const allPublishedApps: PublishedApp[] = findPublishedApps(fileURLToPath(new URL('..', import.meta.url)))
const asked = process.env['E2E_APPS']
export const publishedApps: PublishedApp[] =
  asked === undefined ? allPublishedApps : allPublishedApps.filter((a) => asked.split(',').map((s) => s.trim()).includes(a.slug))
for (const slug of asked?.split(',').map((s) => s.trim()).filter(Boolean) ?? []) {
  if (!allPublishedApps.some((a) => a.slug === slug)) throw new Error(`E2E_APPS names ${slug}, which is no published app in web/apps`)
}

/** Whether this run starts (or publishes) the published app slug (E2E_APPS). */
export const runsApp = (slug: string) => publishedApps.some((a) => a.slug === slug)

// A test-only account created by global setup; not a real credential.
export const admin = { email: 'e2e-admin@example.com', password: 'e2e-password-123', name: 'E2E Admin' }

/**
 * The API connects as the least-privilege role ppe_app (migration 0026), as
 * production does, so every step exercises its grants; setup (prepareDatabase)
 * gives it this test-only password. Setup itself connects as the owner. Roles
 * are shared by every database on the server, so it is the one the Go tests
 * (internal/db/dbtest) and local dev's .env use: any other would leave the dev
 * API unable to sign in after a run.
 */
const appPassword = 'ppe-app-test'

export function appDSN(): string {
  const u = new URL(dbDSN)
  u.username = 'ppe_app'
  u.password = appPassword
  return u.toString()
}

/**
 * Puts each catalogue picture's size group back to migration 0036's: the
 * pictures are fixed rows that TRUNCATE leaves, so a run stopped halfway
 * through changing one would otherwise leave it changed for the next.
 */
const resetPictures = `UPDATE catalogue_pictures SET size_group = CASE
  WHEN icon = 'shoes' THEN 'SHOES'
  WHEN icon IN ('jacket', 'insulated_jacket', 'trousers', 'vest') THEN 'CLOTHING'
  ELSE 'NONE' END`

/**
 * Empties the test database (the trails' TRUNCATE guard asks for the flag),
 * resets the catalogue pictures, and lets ppe_app sign in with the test password.
 */
export async function prepareDatabase(query: (sql: string) => Promise<unknown>, ...more: string[]): Promise<void> {
  await query(
    `BEGIN; SET LOCAL ppe.allow_truncate = on; TRUNCATE users, audit_seals, audit_purges, asset_number_counters CASCADE; ${resetPictures}; ${more.join('; ')}${more.length ? ';' : ''} COMMIT`,
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
    API_SIM_CODES_KEY: 'e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0',
    // Personnel files (ADR 0007): on, for Import Documents' steps.
    API_PERSONNEL_KEY: 'e2e1e2e1e2e1e2e1e2e1e2e1e2e1e2e1e2e1e2e1e2e1e2e1e2e1e2e1e2e1e2e1',
    API_PERSONNEL_INDEX_KEY: 'e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2',
    // Settings → AI seals the OpenAI key with it; OpenAI is the step's fake.
    API_SECRETS_KEY: 'e2e3e2e3e2e3e2e3e2e3e2e3e2e3e2e3e2e3e2e3e2e3e2e3e2e3e2e3e2e3e2e3',
    API_OPENAI_BASE_URL: `http://127.0.0.1:${openAIPort}`,
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
    ...(caddyMode ? { API_APPS_DIR: appsDir } : {}),
  }
}

/** Publishes a published app's build (pnpm build) as version, pointing channel at it, as `make prod-up` does (Caddy mode). */
export function publishBuild(slug: string, version: string, channel = ''): string {
  const build = execFileSync('tar', ['-C', join(repoRoot, 'web/apps', slug, 'dist'), '-cf', '-', '.'], { maxBuffer: 512 << 20 })
  return execFileSync('go', ['run', './cmd/api', '-publish-app', slug, '-version', version, '-channel', channel, '-from-commit', 'e2e'], {
    cwd: repoRoot,
    env: apiEnv(),
    input: build,
    maxBuffer: 16 << 20,
  }).toString()
}
