import { execFileSync } from 'node:child_process'

import { apiEnv, caddyMode, publishBuild, publishedApps, repoRoot } from './env.ts'

/**
 * Seed the test admin. The database was emptied before the API started
 * (prepare-db.ts, the first part of the API's command). Behind Caddy, every
 * published app (Scan SIMs) is published as a deploy publishes it: its first
 * version is Stable.
 */
export default async function globalSetup() {
  execFileSync('go', ['run', './cmd/api', '-seed-admin'], { cwd: repoRoot, env: apiEnv(), stdio: 'inherit' })
  if (caddyMode) for (const app of publishedApps) process.stdout.write(publishBuild(app.slug, '2026.01.01-e2e', 'preview'))
}
