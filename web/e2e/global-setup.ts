import { execFileSync } from 'node:child_process'

import pg from 'pg'

import { apiEnv, dbDSN, repoRoot } from './env.ts'

/**
 * Empty the e2e database and seed the test admin. Runs before the web
 * servers start. The database must already be migrated (`make db-test-create`
 * locally; the CI workflow migrates it).
 */
export default async function globalSetup() {
  if (!new URL(dbDSN).pathname.endsWith('_test')) {
    throw new Error(`Refusing to empty ${dbDSN}: the e2e database name must end in _test`)
  }
  const client = new pg.Client({ connectionString: dbDSN })
  await client.connect()
  try {
    await client.query('TRUNCATE users CASCADE')
  } finally {
    await client.end()
  }
  execFileSync('go', ['run', './cmd/api', '-seed-admin'], { cwd: repoRoot, env: apiEnv(), stdio: 'inherit' })
}
