-- Shared links (WARE-51, docs/specs/share-service.md): up to ten employees'
-- rows with the columns chosen, as the sharer saw them, open to anyone with
-- the link until it expires or its sharer revokes it. Only the token's hash
-- is kept. Revoking empties the rows at once, and the upkeep empties those of
-- every expired link (erased_at); the row stays, so who shared whose details
-- (subject_ids) remains known. The actors' keys mean TRUNCATE users CASCADE
-- empties it too.
CREATE TABLE shares (
    id                 UUID PRIMARY KEY,
    kind               TEXT NOT NULL CHECK (kind IN ('employees')),
    name               TEXT NOT NULL CHECK (name <> '' AND char_length(name) <= 100),
    token_hash         TEXT NOT NULL UNIQUE,
    columns            TEXT[] NOT NULL CHECK (cardinality(columns) BETWEEN 1 AND 50),
    subject_ids        UUID[] NOT NULL CHECK (cardinality(subject_ids) BETWEEN 1 AND 10),
    rows               JSONB NOT NULL CHECK (jsonb_typeof(rows) = 'array'),
    expires_at         TIMESTAMPTZ NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users (id),
    revoked_at         TIMESTAMPTZ,
    revoked_by_user_id UUID REFERENCES users (id),
    erased_at          TIMESTAMPTZ,
    CHECK (expires_at > created_at),
    CHECK ((revoked_at IS NULL) = (revoked_by_user_id IS NULL)),
    -- Erased rows are empty; until then there is one per subject.
    CHECK (CASE WHEN erased_at IS NULL THEN jsonb_array_length(rows) = cardinality(subject_ids) ELSE rows = '[]'::jsonb END)
);

-- Shared Links: a user's open links, newest first.
CREATE INDEX shares_created_by_idx ON shares (created_by_user_id, created_at DESC) WHERE revoked_at IS NULL;
-- The upkeep: expired links not yet erased.
CREATE INDEX shares_unerased_idx ON shares (expires_at) WHERE erased_at IS NULL;
