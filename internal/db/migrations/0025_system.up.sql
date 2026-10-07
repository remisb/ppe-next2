-- Administration's System screen and Overview (docs/specs/system-service.md).
--
-- error_events is the error list: 5xx answers, recovered panics and errors the
-- apps report from the browser. Identical errors (one fingerprint) within an
-- hour of the last are folded into one row with a count, so a row is updated;
-- this is an operational record, not the audit trail. Rows are kept 30 days.
CREATE TABLE error_events (
    id              UUID PRIMARY KEY,
    fingerprint     TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{16}$'),
    kind            TEXT NOT NULL CHECK (kind IN ('server', 'panic', 'client')),
    -- The route pattern for the API's own errors; the page's path, ids
    -- replaced, for the apps'.
    route           TEXT NOT NULL,
    method          TEXT NOT NULL DEFAULT '',
    status          INTEGER,
    message         TEXT NOT NULL,
    stack           TEXT NOT NULL DEFAULT '',
    source          TEXT CHECK (source IN ('workwear', 'admin', 'api', 'public_link', 'system')),
    first_seen      TIMESTAMPTZ NOT NULL,
    last_seen       TIMESTAMPTZ NOT NULL,
    count           INTEGER NOT NULL CHECK (count >= 1),
    -- The latest occurrence: its request (the reference people quote), its
    -- signed-in user and browser.
    last_request_id TEXT,
    last_user_id    UUID REFERENCES users (id),
    last_user_agent TEXT
);

CREATE INDEX error_events_seen_idx        ON error_events (last_seen DESC, id DESC);
CREATE INDEX error_events_fingerprint_idx ON error_events (fingerprint, last_seen DESC);

-- The database's size once a day, for its growth on System and the Overview.
CREATE TABLE db_size_samples (
    day   DATE PRIMARY KEY,
    bytes BIGINT NOT NULL CHECK (bytes >= 0)
);

-- The System screen is a permission of its own; the built-in Administrator
-- holds every administration permission (role.builtins).
INSERT INTO role_permissions (role_id, permission)
VALUES ('a0e1d000-0000-4000-8000-000000000001', 'system.read')
ON CONFLICT DO NOTHING;
