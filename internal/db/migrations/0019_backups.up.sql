-- dbbackup schema v1 (github.com/remisb/dbbackup/postgres).
-- The run history a backup agent writes and an application reads. Copy this
-- file into the application's migrations unchanged; a later schema version
-- ships its own migration.

-- One row per backup attempt, inserted when the attempt ends. Only deleted_at
-- changes afterwards: it is set when retention deletes the file.
CREATE TABLE dbbackup_runs (
    id             UUID        PRIMARY KEY,
    agent          TEXT        NOT NULL,
    engine         TEXT        NOT NULL,
    database_name  TEXT        NOT NULL,
    server_version TEXT        NOT NULL DEFAULT '',
    tool_version   TEXT        NOT NULL DEFAULT '',
    started_at     TIMESTAMPTZ NOT NULL,
    finished_at    TIMESTAMPTZ NOT NULL,
    status         TEXT        NOT NULL CHECK (status IN ('succeeded', 'failed')),
    error          TEXT        NOT NULL DEFAULT '',
    target         TEXT        NOT NULL DEFAULT '',
    object_key     TEXT        NOT NULL DEFAULT '',
    size_bytes     BIGINT      NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    sha256         TEXT        NOT NULL DEFAULT '',
    transforms     TEXT[]      NOT NULL DEFAULT '{}',
    deleted_at     TIMESTAMPTZ
);

CREATE INDEX dbbackup_runs_started_at_idx ON dbbackup_runs (started_at DESC);
CREATE INDEX dbbackup_runs_object_key_idx ON dbbackup_runs (object_key) WHERE deleted_at IS NULL;

-- One row per agent, replaced on every heartbeat.
CREATE TABLE dbbackup_agents (
    name             TEXT        PRIMARY KEY,
    engine           TEXT        NOT NULL,
    database_name    TEXT        NOT NULL,
    schedule         TEXT        NOT NULL DEFAULT '',
    timezone         TEXT        NOT NULL DEFAULT '',
    interval_seconds BIGINT      NOT NULL DEFAULT 0,
    target           TEXT        NOT NULL DEFAULT '',
    retention        TEXT        NOT NULL DEFAULT '',
    transforms       TEXT[]      NOT NULL DEFAULT '{}',
    version          TEXT        NOT NULL DEFAULT '',
    next_run_at      TIMESTAMPTZ,
    last_seen_at     TIMESTAMPTZ NOT NULL
);
