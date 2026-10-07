import { execFileSync } from 'node:child_process'

import pg from 'pg'

import { apiEnv, dbDSN, prepareDatabase, repoRoot } from '../env.ts'
import { agents, lang, tsaURL } from './lang.ts'

/**
 * Like the e2e setup (it empties the same _test database), then the demo data,
 * with record numbers from WE-000001, a staff name fit for a guide and the
 * admin set to the guide's language, and a backup history: the backup agent
 * writes that, not the API, so it is inserted here. Administration's Usage,
 * Security and System read what weeks of use leave behind, so a month of it is
 * inserted too (demoUse), and the API's upkeep then runs once (-upkeep): it
 * seals the demo's past days for the Audit log and timestamps them (tsaURL),
 * and samples the data's quality, from which demoQuality draws the trend
 * before today.
 */
export default async function guideSetup() {
  if (!new URL(dbDSN).pathname.endsWith('_test')) {
    throw new Error(`Refusing to empty ${dbDSN}: the database name must end in _test`)
  }
  const client = new pg.Client({ connectionString: dbDSN })
  await client.connect()
  try {
    await prepareDatabase((sql) => client.query(sql), 'ALTER SEQUENCE order_record_seq RESTART')
  } finally {
    await client.end()
  }
  const env = { ...apiEnv(), API_SEED_USER_NAME: 'Office Admin', API_AUDIT_TSA_URL: tsaURL }
  for (const flag of ['-seed-admin', '-seed-demo']) {
    execFileSync('go', ['run', './cmd/api', flag], { cwd: repoRoot, env, stdio: 'inherit' })
  }
  // The admin works in the guide's language from the first sign-in.
  const again = new pg.Client({ connectionString: dbDSN })
  await again.connect()
  try {
    await again.query('UPDATE users SET language = $1', [lang])
    await again.query(demoBackups)
    await again.query(demoUse)
    execFileSync('go', ['run', './cmd/api', '-upkeep'], { cwd: repoRoot, env, stdio: 'inherit' })
    await again.query(demoQuality)
  } finally {
    await again.end()
  }
}

/**
 * A month of use: two managers (who never sign in here: they have no
 * password), the days each of the three used the apps, their sign-ins with a
 * few failed attempts, two errors on the error list, and the confirmation links
 * employees opened. Addresses are from the documentation ranges.
 */
const demoUse = `
WITH a AS (SELECT id FROM users ORDER BY created_at LIMIT 1)
INSERT INTO users (id, email, name, password_hash, created_at, updated_at, created_by_user_id, updated_by_user_id, language, last_sign_in_at)
SELECT v.id::uuid, v.email, v.name, '!', now() - interval '120 days', now() - interval '120 days', a.id, a.id, v.language, now() - v.ago::interval
FROM a, (VALUES
  ('b0e1d000-0000-4000-8000-0000000000a1', 'ruta.vaitkiene@example.com', 'Rūta Vaitkienė', 'lt', '3 hours'),
  ('b0e1d000-0000-4000-8000-0000000000a2', 'igor.petrov@example.com', 'Igor Petrov', 'ru', '1 day')
) v(id, email, name, language, ago);
INSERT INTO user_roles (user_id, role_id)
VALUES ('b0e1d000-0000-4000-8000-0000000000a1', 'a0e1d000-0000-4000-8000-000000000002'),
       ('b0e1d000-0000-4000-8000-0000000000a2', 'a0e1d000-0000-4000-8000-000000000002');

-- Weekdays mostly, each person missing some; the administrator in Administration now and then.
WITH days AS (
  SELECT (now() AT TIME ZONE 'Europe/Vilnius')::date - n AS day FROM generate_series(1, 29) n
), people AS (SELECT id, row_number() OVER (ORDER BY created_at) AS k FROM users)
INSERT INTO user_activity (day, user_id, app)
SELECT day, id, app FROM days, people, (VALUES ('workwear'), ('admin')) apps(app)
WHERE extract(isodow FROM day) < 6
  AND abs(hashtext(id::text || day::text)) % 7 <> 0
  AND (app = 'workwear' OR (k = 1 AND abs(hashtext(day::text)) % 3 = 0));

-- A sign-in every few working days, kept for weeks, and a few failed attempts.
WITH days AS (
  SELECT (now() AT TIME ZONE 'Europe/Vilnius')::date - n AS day, n FROM generate_series(1, 29) n
), people AS (SELECT id, row_number() OVER (ORDER BY created_at) AS k FROM users)
INSERT INTO auth_events (id, occurred_at, kind, user_id, reason, ip, user_agent, source)
SELECT gen_random_uuid(), (day + time '07:40' + k * interval '23 minutes') AT TIME ZONE 'Europe/Vilnius',
       CASE WHEN failed THEN 'sign_in_failed' ELSE 'sign_in' END, id,
       CASE WHEN failed THEN 'bad_password' END,
       CASE k WHEN 1 THEN '203.0.113.24' WHEN 2 THEN '198.51.100.7' ELSE '198.51.100.42' END,
       CASE k WHEN 2 THEN '${agents.iphone}' ELSE '${agents.windows}' END, 'workwear'
FROM days, people, LATERAL (SELECT abs(hashtext(id::text || day::text)) % 11 = 0 AS failed) f
WHERE extract(isodow FROM day) < 6 AND (n + k) % 4 = 0 OR (failed AND extract(isodow FROM day) < 6);

-- A server error that recurred, and a new one in a browser.
INSERT INTO error_events (id, fingerprint, kind, route, method, status, message, source, first_seen, last_seen, count, last_request_id, last_user_id, last_user_agent)
VALUES
  (gen_random_uuid(), '4f1c2a9d7e3b6a05', 'server', 'GET /api/v1/orders', 'GET', 500,
   'list orders: timeout: context deadline exceeded', 'workwear', now() - interval '6 days', now() - interval '3 hours', 3,
   '9f2c1a7e5b3d4c8a9e1f2a3b4c5d6e7f', 'b0e1d000-0000-4000-8000-0000000000a1', '${agents.windows}'),
  (gen_random_uuid(), 'a83e5d0c1b97f264', 'client', '/employees/:id', '', NULL,
   'TypeError: Cannot read properties of undefined (reading ''sizes'')', 'workwear', now() - interval '5 hours', now() - interval '5 hours', 1,
   NULL, 'b0e1d000-0000-4000-8000-0000000000a2', '${agents.iphone}');

-- Employees opened most links; every confirmed one was opened first.
UPDATE order_confirmations
SET first_opened_at = created_at + interval '2 hours'
WHERE method = 'ELECTRONIC' AND (confirmed_at IS NOT NULL OR abs(hashtext(id::text)) % 3 <> 0);
`

/** The data's quality before today, worse the further back, from the sample the upkeep took today. */
const demoQuality = `
INSERT INTO data_quality_samples (day, employees, employees_missing_sizes, catalogue_active, catalogue_unpriced, item_sets_active)
SELECT t.day - n, greatest(t.employees - n / 12, 1), t.employees_missing_sizes + n / 15, t.catalogue_active,
       t.catalogue_unpriced + n / 30, t.item_sets_active
FROM (SELECT * FROM data_quality_samples ORDER BY day DESC LIMIT 1) t, generate_series(1, 89) n
ON CONFLICT (day) DO NOTHING;
`

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
