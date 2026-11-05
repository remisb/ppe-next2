// Empties the e2e database and lets the API's role ppe_app sign in with the
// test password. It runs as the first part of the API's command (see
// playwright.config.ts): Playwright starts its web servers before global
// setup, and the API seals and purges as soon as it starts, so the database
// must be empty before then. The database must already be migrated
// (`make db-test-create` locally; the CI workflow migrates it).
//
// Behind Caddy it also empties the published apps' folder, which starts empty
// with the database: global setup publishes each app under a fixed version
// (2026.01.01-e2e), and publishing keeps a version's folder that is already
// there, so a folder left by an earlier run would serve that run's build. Its
// contents go, not the folder: Caddy's container mounts it.
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'

import { appsDir, caddyMode, dbDSN, prepareDatabase } from './env.ts'

if (!new URL(dbDSN).pathname.endsWith('_test')) {
  throw new Error(`Refusing to empty ${dbDSN}: the e2e database name must end in _test`)
}
if (caddyMode && existsSync(appsDir)) {
  for (const entry of readdirSync(appsDir)) rmSync(join(appsDir, entry), { recursive: true, force: true })
}

const client = new pg.Client({ connectionString: dbDSN })
await client.connect()
try {
  // The backup agent's tables reference no user; the guide's setup fills them.
  await prepareDatabase((sql) => client.query(sql), 'TRUNCATE dbbackup_runs, dbbackup_agents', 'TRUNCATE db_size_samples')
} finally {
  await client.end()
}
