CREATE TABLE users (
    id                 UUID PRIMARY KEY,
    email              TEXT NOT NULL,
    name               TEXT NOT NULL,
    password_hash      TEXT NOT NULL,
    roles              TEXT[] NOT NULL,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    deleted_at         TIMESTAMPTZ,
    -- Actor columns reference users itself. The first admin is created by
    -- `-seed-admin` and attributed to its own id, which a self-referencing
    -- row satisfies within the same statement.
    created_by_user_id UUID NOT NULL REFERENCES users (id),
    updated_by_user_id UUID NOT NULL REFERENCES users (id),
    deleted_by_user_id UUID REFERENCES users (id),

    CONSTRAINT users_roles_known CHECK (
        cardinality(roles) > 0
        AND roles <@ ARRAY['admin', 'manager', 'employee']::TEXT[]
    ),
    CONSTRAINT users_deletion_pair CHECK (
        (deleted_at IS NULL) = (deleted_by_user_id IS NULL)
    )
);

-- Email is unique among live users only, case-insensitively, so a deleted
-- account's address can be reused.
CREATE UNIQUE INDEX users_email_live_idx ON users (lower(email)) WHERE deleted_at IS NULL;
