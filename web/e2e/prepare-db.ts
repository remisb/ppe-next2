// Empties the e2e database and lets the API's role ppe_app sign in with the
// test password. It runs as the first part of the API's command (see
// playwright.config.ts): Playwright starts its web servers before global
// setup, and the API seals and purges as soon as it starts, so the database
// must be empty before then. The database must already be migrated
// (`make db-test-create` locally; the CI workflow migrates it).
import pg from 'pg'

import { dbDSN, prepareDatabase } from './env.ts'

if (!new URL(dbDSN).pathname.endsWith('_test')) {
  throw new Error(`Refusing to empty ${dbDSN}: the e2e database name must end in _test`)
}
const client = new pg.Client({ connectionString: dbDSN })
await client.connect()
try {
  // The backup agent's tables reference no user; the guide's setup fills them.
  await prepareDatabase((sql) => client.query(sql), 'TRUNCATE dbbackup_runs, dbbackup_agents', 'TRUNCATE db_size_samples')
} finally {
  await client.end()
}
