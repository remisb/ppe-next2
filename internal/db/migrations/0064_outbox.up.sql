-- Events & jobs, the outbox (ADR 0008 decision 9, docs/specs/outbox-service.md):
-- work that must happen because of a change but not inside its request (reading
-- a file's text), written in the change's transaction and run by the worker
-- (`api -worker`), at least once.
CREATE SCHEMA outbox;

CREATE TABLE outbox.jobs (
    id            UUID PRIMARY KEY,
    kind          TEXT NOT NULL CHECK (kind ~ '^[a-z][a-z_]*(\.[a-z_]+)+$' AND char_length(kind) <= 60),
    -- What the job is about; with kind, one live job at a time.
    key           TEXT NOT NULL CHECK (char_length(key) BETWEEN 1 AND 200),
    -- Ids only: never personal data, a file or its text.
    payload       JSONB NOT NULL DEFAULT '{}' CHECK (octet_length(payload::text) <= 4096),
    state         TEXT NOT NULL CHECK (state IN ('pending', 'running', 'done', 'failed')),
    attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts  INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
    run_after     TIMESTAMPTZ NOT NULL,
    lease_until   TIMESTAMPTZ,
    worker        TEXT CHECK (char_length(worker) <= 100),
    -- A code and a short message from the handler, never text from a file.
    last_error    TEXT CHECK (char_length(last_error) <= 500),
    created_at    TIMESTAMPTZ NOT NULL,
    finished_at   TIMESTAMPTZ
);

-- One live job per kind and key: enqueuing twice is one job.
CREATE UNIQUE INDEX outbox_jobs_live_idx ON outbox.jobs (kind, key) WHERE state IN ('pending', 'running');
-- What a worker claims: due pending jobs, oldest first.
CREATE INDEX outbox_jobs_due_idx ON outbox.jobs (run_after) WHERE state = 'pending';
CREATE INDEX outbox_jobs_finished_idx ON outbox.jobs (finished_at) WHERE state IN ('done', 'failed');

-- Each worker's heartbeat: its tools and the kinds it serves, for System.
CREATE TABLE outbox.workers (
    name        TEXT PRIMARY KEY CHECK (char_length(name) BETWEEN 1 AND 100),
    version     TEXT NOT NULL DEFAULT '' CHECK (char_length(version) <= 100),
    tools       JSONB NOT NULL DEFAULT '{}',
    kinds       TEXT[] NOT NULL DEFAULT '{}',
    started_at  TIMESTAMPTZ NOT NULL,
    seen_at     TIMESTAMPTZ NOT NULL
);

-- The purge, as the owner, so ppe_app needs no DELETE on jobs: done jobs
-- older than done_before, failed ones older than failed_before.
CREATE FUNCTION outbox.purge_jobs(done_before TIMESTAMPTZ, failed_before TIMESTAMPTZ) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = outbox, pg_temp AS $$
DECLARE n BIGINT;
BEGIN
    DELETE FROM outbox.jobs WHERE (state = 'done' AND finished_at < done_before)
        OR (state = 'failed' AND finished_at < failed_before);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;
