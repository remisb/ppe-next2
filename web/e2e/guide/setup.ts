import { execFileSync } from 'node:child_process'

import pg from 'pg'

import { apiEnv, dbDSN, repoRoot } from '../env.ts'

/**
 * Like the e2e setup (it empties the same _test database), then the demo data,
 * with record numbers from WE-000001 and a staff name fit for a guide.
 */
export default async function guideSetup() {
  if (!new URL(dbDSN).pathname.endsWith('_test')) {
    throw new Error(`Refusing to empty ${dbDSN}: the database name must end in _test`)
  }
  const client = new pg.Client({ connectionString: dbDSN })
  await client.connect()
  try {
    await client.query('TRUNCATE users CASCADE')
    await client.query('ALTER SEQUENCE order_record_seq RESTART')
  } finally {
    await client.end()
  }
  const env = { ...apiEnv(), API_SEED_USER_NAME: 'Office Admin' }
  for (const flag of ['-seed-admin', '-seed-demo']) {
    execFileSync('go', ['run', './cmd/api', flag], { cwd: repoRoot, env, stdio: 'inherit' })
  }
}
