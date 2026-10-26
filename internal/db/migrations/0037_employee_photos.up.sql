-- Employee photos: any number per employee, one of them the default (the
-- avatar), each optionally tagged with the uses it serves. The file is in
-- object storage (internal/files) under object_key. Photos are soft-deleted
-- like everything else; the file stays in the bucket.
CREATE TABLE employee_photos (
    id                  UUID PRIMARY KEY,
    employee_id         UUID NOT NULL REFERENCES employees (id),
    object_key          TEXT NOT NULL UNIQUE,
    file_name           TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
    content_type        TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
    size_bytes          BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    sha256              TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    uses                TEXT[] NOT NULL DEFAULT '{}'
                        CHECK (uses <@ ARRAY['profile', 'id_badge', 'sizing', 'receipt']),
    is_default          BOOLEAN NOT NULL DEFAULT false,
    uploaded_at         TIMESTAMPTZ NOT NULL,
    uploaded_by_user_id UUID NOT NULL REFERENCES users (id),
    deleted_at          TIMESTAMPTZ,
    deleted_by_user_id  UUID REFERENCES users (id),
    CHECK (NOT (is_default AND deleted_at IS NOT NULL))
);

CREATE INDEX employee_photos_employee_idx ON employee_photos (employee_id, uploaded_at) WHERE deleted_at IS NULL;
-- At most one default photo per employee.
CREATE UNIQUE INDEX employee_photos_default_idx ON employee_photos (employee_id) WHERE is_default AND deleted_at IS NULL;
