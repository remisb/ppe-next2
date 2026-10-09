-- Signed copies (Company Assets slice 5, ADR 0004): a scan or photo of the
-- signed assignment form, one row per upload. The file is in object storage
-- (Spaces, internal/files) under object_key; this row says which assignment it
-- belongs to and what it is. Uploading again adds a row: the newest is the
-- copy shown, the earlier ones stay. Rows are never changed or deleted.
CREATE TABLE asset_signed_copies (
    id                  UUID PRIMARY KEY,
    assignment_id       UUID NOT NULL REFERENCES asset_assignments (id),
    object_key          TEXT NOT NULL UNIQUE,
    file_name           TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
    content_type        TEXT NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    size_bytes          BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    sha256              TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    uploaded_at         TIMESTAMPTZ NOT NULL,
    uploaded_by_user_id UUID NOT NULL REFERENCES users (id)
);

CREATE INDEX asset_signed_copies_assignment_idx ON asset_signed_copies (assignment_id, uploaded_at DESC);

CREATE FUNCTION asset_signed_copies_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'asset_signed_copies are never changed or deleted';
END;
$$;

CREATE TRIGGER asset_signed_copies_guard
    BEFORE UPDATE OR DELETE ON asset_signed_copies
    FOR EACH ROW EXECUTE FUNCTION asset_signed_copies_guard();
