-- Document Vault, phase 3 (ADR 0008 decisions 6 and 7,
-- docs/specs/document-template-service.md): document templates, edited in
-- Administration and published as versions that never change, and the
-- numbers generated documents get.

-- A template: the text of a kind of document, for one document type.
CREATE TABLE vault.templates (
    id                  UUID PRIMARY KEY,
    type                TEXT NOT NULL CHECK (type ~ '^[a-z][a-z_]*(\.[a-z_]+)*$' AND char_length(type) <= 60),
    name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    -- How long dates and money are written: lt, en or ru.
    language            TEXT NOT NULL CHECK (language IN ('lt', 'en', 'ru')),
    -- The published version Generate uses; null until the first is published.
    current_version     INTEGER CHECK (current_version >= 1),
    retired_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL,
    created_by_user_id  UUID NOT NULL REFERENCES users (id),
    updated_at          TIMESTAMPTZ NOT NULL,
    updated_by_user_id  UUID NOT NULL REFERENCES users (id),
    deleted_at          TIMESTAMPTZ,
    deleted_by_user_id  UUID REFERENCES users (id),
    CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL))
);

CREATE UNIQUE INDEX vault_templates_name_live_idx ON vault.templates (type, lower(name)) WHERE deleted_at IS NULL;

-- A template's versions: one draft at most, and published ones, which never change.
CREATE TABLE vault.template_versions (
    template_id           UUID NOT NULL REFERENCES vault.templates (id),
    number                INTEGER NOT NULL CHECK (number >= 1),
    state                 TEXT NOT NULL CHECK (state IN ('draft', 'published')),
    -- ppe.blocks.v1: the blocks and their inline runs (internal/vault/template).
    body                  JSONB NOT NULL,
    -- The fields the template asks for when a document is generated.
    asked                 JSONB NOT NULL DEFAULT '[]',
    -- Of the canonical body and asked fields, part of every generated document's hash.
    body_sha256           TEXT NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
    updated_at            TIMESTAMPTZ NOT NULL,
    updated_by_user_id    UUID NOT NULL REFERENCES users (id),
    published_at          TIMESTAMPTZ,
    published_by_user_id  UUID REFERENCES users (id),
    PRIMARY KEY (template_id, number),
    CHECK ((state = 'published') = (published_at IS NOT NULL)),
    CHECK ((published_at IS NULL) = (published_by_user_id IS NULL)),
    CHECK (octet_length(body::text) <= 262144)
);

CREATE UNIQUE INDEX vault_template_versions_draft_idx ON vault.template_versions (template_id) WHERE state = 'draft';

-- A published version is never changed or deleted; a draft may be saved,
-- published (once) or discarded.
CREATE FUNCTION vault.template_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.state = 'published' THEN
        RAISE EXCEPTION 'a published template version is never changed or deleted';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER vault_template_versions_guard BEFORE UPDATE OR DELETE ON vault.template_versions
    FOR EACH ROW EXECUTE FUNCTION vault.template_versions_guard();

-- Generated documents' numbers, per type and year: EC-2026-0001.
CREATE TABLE vault.document_number_counters (
    type  TEXT NOT NULL,
    year  INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 9999),
    last  INTEGER NOT NULL CHECK (last >= 0),
    PRIMARY KEY (type, year)
);

-- A generated document's template and version.
ALTER TABLE vault.documents
    ADD COLUMN template_id UUID REFERENCES vault.templates (id),
    ADD COLUMN template_version INTEGER,
    ADD CONSTRAINT vault_documents_template_pair CHECK ((template_id IS NULL) = (template_version IS NULL));

-- A generated version's values, as they printed (a sealed one's are in data_sealed).
ALTER TABLE vault.versions ADD COLUMN data JSONB CHECK (octet_length(data::text) <= 65536);

-- Manage document templates: the Administrator's (role.AdminID).
INSERT INTO role_permissions (role_id, permission)
VALUES ('a0e1d000-0000-4000-8000-000000000001', 'document_templates.manage') ON CONFLICT DO NOTHING;
