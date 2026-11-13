-- Kept scans (ADR 0007 amendment, docs/specs/personnel-service.md "Kept
-- scans"): Import Documents' Scan Document builds one person's document pages
-- into a zip the API keeps for API_PERSONNEL_SCAN_DAYS (3) days, for the user
-- who made it alone.
--
-- The zip is in the files store (object_key), sealed with the scan's own data
-- key; the key, sealed by the master keyring API_PERSONNEL_KEY, and the sealed
-- meta (names, kind, number, file name) are here. Deleting the row (Remove,
-- or the upkeep once expires_at has passed) is the erasure: a hard delete, as
-- the shredding of a personnel file is. A row is never changed.
CREATE TABLE personnel.scans (
    id                  UUID PRIMARY KEY,
    created_by_user_id  UUID NOT NULL REFERENCES users (id),
    created_at          TIMESTAMPTZ NOT NULL,
    expires_at          TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at),
    object_key          TEXT NOT NULL UNIQUE CHECK (object_key ~ '^personnel-scans/'),
    -- The plain zip's size and SHA-256, checked on opening: ten pages of 5 MB and the zip's headers.
    bytes               INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 53477376),
    sha256              BYTEA NOT NULL CHECK (octet_length(sha256) = 32),
    sealed_key          BYTEA NOT NULL CHECK (octet_length(sealed_key) BETWEEN 29 AND 100),
    key_id              SMALLINT NOT NULL CHECK (key_id >= 1),
    sealed_meta         BYTEA NOT NULL CHECK (octet_length(sealed_meta) BETWEEN 29 AND 4000),
    pages               SMALLINT NOT NULL CHECK (pages BETWEEN 1 AND 10)
);
CREATE INDEX scans_created_by_idx ON personnel.scans (created_by_user_id, expires_at);
CREATE INDEX scans_expires_idx ON personnel.scans (expires_at);
