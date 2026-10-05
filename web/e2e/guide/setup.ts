import { execFileSync } from 'node:child_process'

import pg from 'pg'

import { apiEnv, dbDSN, repoRoot } from '../env.ts'
import { lang } from './lang.ts'

/**
 * Like the e2e setup (it empties the same _test database), then the demo data,
 * with record numbers from WE-000001, a staff name fit for a guide and the
 * admin set to the guide's language, and a backup history: the backup agent
 * writes that, not the API, so it is inserted here.
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
    await again.query(demoBackups)
  } finally {
    await again.end()
  }
}

/**
 * A backup agent that reported two minutes ago, saving to a Spaces bucket, and
 * its last ten nightly runs at 03:00 in Vilnius, the one five nights ago failed.
 */
const demoBackups = `
TRUNCATE dbbackup_runs, dbbackup_agents;
WITH last AS (
  SELECT CASE WHEN t > now() THEN t - interval '1 day' ELSE t END AS at
  FROM (SELECT (date_trunc('day', now() AT TIME ZONE 'Europe/Vilnius') + interval '3 hours') AT TIME ZONE 'Europe/Vilnius' AS t) x
)
INSERT INTO dbbackup_agents (name, engine, database_name, schedule, timezone, interval_seconds, target, retention, version, next_run_at, last_seen_at)
SELECT 'ppe-next2', 'postgres', 'ppe2', '0 3 * * *', 'Europe/Vilnius', 86400, 's3://ppe-backups (fra1.digitaloceanspaces.com)',
       '14 days, at least 7', 'v0.1.0', at + interval '1 day', now() - interval '2 minutes'
FROM last;
WITH last AS (
  SELECT CASE WHEN t > now() THEN t - interval '1 day' ELSE t END AS at
  FROM (SELECT (date_trunc('day', now() AT TIME ZONE 'Europe/Vilnius') + interval '3 hours') AT TIME ZONE 'Europe/Vilnius' AS t) x
), runs AS (
  SELECT at - n * interval '1 day' AS started, n, n = 5 AS failed FROM last, generate_series(0, 9) n
)
INSERT INTO dbbackup_runs (id, agent, engine, database_name, server_version, tool_version, started_at, finished_at, status, error, target, object_key, size_bytes, sha256)
SELECT gen_random_uuid(), 'ppe-next2', 'postgres', 'ppe2',
       CASE WHEN failed THEN '' ELSE '18.4' END, '18.4',
       started, started + (240 + n * 17) * interval '1 millisecond',
       CASE WHEN failed THEN 'failed' ELSE 'succeeded' END,
       CASE WHEN failed THEN 'pg_dump: error: connection to server at "db", port 5432 failed: the database system is starting up' ELSE '' END,
       's3://ppe-backups (fra1.digitaloceanspaces.com)',
       CASE WHEN failed THEN '' ELSE 'ppe2/ppe2/' || to_char(started AT TIME ZONE 'UTC', 'YYYY/MM/DD') || '/ppe2-' || to_char(started AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || '.dump' END,
       CASE WHEN failed THEN 0 ELSE 67072 - n * 412 END,
       CASE WHEN failed THEN '' ELSE md5(n::text) || md5(n::text) END
FROM runs;
`
