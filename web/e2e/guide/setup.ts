import { execFileSync } from 'node:child_process'

import pg from 'pg'

import { apiEnv, dbDSN, repoRoot } from '../env.ts'
import { lang } from './lang.ts'

/**
 * Like the e2e setup (it empties the same _test database), then the demo data,
 * with record numbers from WE-000001, a staff name fit for a guide and the
 * admin set to the guide's language.
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
  // The admin works in the guide's language from the first sign-in.
  const again = new pg.Client({ connectionString: dbDSN })
  await again.connect()
  try {
    await again.query('UPDATE users SET language = $1', [lang])
  } finally {
    await again.end()
  }
}
