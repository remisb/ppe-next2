import { execFileSync } from 'node:child_process'

import { apiEnv, repoRoot } from './env.ts'

/**
 * Seed the test admin. The database was emptied before the API started
 * (prepare-db.ts, the first part of the API's command).
 */
export default async function globalSetup() {
  execFileSync('go', ['run', './cmd/api', '-seed-admin'], { cwd: repoRoot, env: apiEnv(), stdio: 'inherit' })
}
