# Backup service

What administrators see about the database backups: `internal/domain/backup`, route in
`cmd/api/backup-routes.go`. It only reads. The backups themselves are taken by the backup
agent, a separate compose service built from
[github.com/remisb/dbbackup](https://github.com/remisb/dbbackup) (`cmd/dbbackup`), which
writes the tables `dbbackup_runs` and `dbbackup_agents` (migration 0019). Operating it,
restoring and upgrading Postgres: [docs/backups.md](../backups.md).

| Route | Access |
| --- | --- |
| `GET /api/v1/backups` | `backups.read` (administrators): the status below |

In the web app it is the Backups screen in Administration (`/admin/backups`), and a Backups
card under Setup on the administrator's Dashboard in the staff app that opens it (the
verdict's words are `@ppe/backups`'). The staff app's old `/backups` leads there.

## Status

`{generated_at, timezone, agent, last_success, runs, kept, stale, agent_offline, last_run_failed}`:

- `agent`: the agent that reported most recently (`name, schedule, timezone,
  interval_seconds, target, retention, encrypted, version, next_run_at, last_seen_at`), or
  `null` when none ever has. `target` never contains credentials.
- `runs`: the newest 30 attempts, newest first, `[]` when there are none. Each is `{id,
  started_at, finished_at, duration_ms, status (succeeded|failed), error, size_bytes,
  server_version, tool_version, target, key, encrypted, pruned}`.
- `last_success`: the newest successful run, or `null`.
- `kept`: `{count, bytes}` of successful runs whose file retention has not deleted.
- `timezone`: the organisation's (`API_ORG_TIMEZONE`), which the screen shows times in.

Derived by the service:

- `stale`: no successful backup, or the newest started longer ago than the agent's
  `interval_seconds` (the gap between two scheduled runs; a day when no agent reported) plus
  a 2-hour grace.
- `agent_offline`: no agent, or its `last_seen_at` is older than 15 minutes (it writes a
  heartbeat every 5).
- `last_run_failed`: the newest run failed.

The screen names the worst first: no agent, agent offline, last run failed (with the
agent's error, in English), no backup yet, overdue, up to date. It also warns while backups
are kept only on the server (`file://` target).

## Rules

- The tables belong to dbbackup's schema version 1. Migration 0019 is
  `postgres/schema.sql` from the dbbackup version in `go.mod`, copied verbatim;
  `TestMigrationMatchesLibrarySchema` fails when they differ, so a dbbackup upgrade that
  changes the schema needs a new migration first.
- Reads go through dbbackup's own `postgres.Reader`, in one read-only `REPEATABLE READ`
  transaction.
- Run rows are inserted once, when a run ends; only `deleted_at` changes afterwards (set
  when retention deletes the file). Nothing in the app writes these tables.
- A restore replaces the whole database, these tables included, so the history then ends
  at the restored backup.
