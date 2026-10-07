-- Trusted timestamps of the Audit log's seals (ADR 0003, internal/audit
-- stamp.go): each day's seal hash, timestamped by a public timestamp service
-- (RFC 3161, API_AUDIT_TSA_URL), anchors the seals outside the database. A
-- token cannot be made later with an earlier time, so rewriting the trail and
-- its seals shows even to someone who holds the database. Verify checks each
-- token; append-only like the seals themselves.
CREATE TABLE audit_seal_stamps (
    day         DATE PRIMARY KEY REFERENCES audit_seals (day),
    -- The timestamp service's URL.
    tsa         TEXT NOT NULL CHECK (tsa <> ''),
    -- Its signed answer (a DER TimeStampToken holding its certificates).
    token       BYTEA NOT NULL CHECK (length(token) > 0),
    -- The time the token states, and when it was stored.
    stamped_at  TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL
);

CREATE TRIGGER audit_seal_stamps_no_update_delete BEFORE UPDATE OR DELETE ON audit_seal_stamps
    FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER audit_seal_stamps_no_truncate BEFORE TRUNCATE ON audit_seal_stamps
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_truncate();
