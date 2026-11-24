-- Document Vault, phase 1 (ADR 0008, docs/specs/vault-service.md): typed
-- documents with versions, files and links to the people and things they are
-- about, and their search. Schema vault is the context's (ADR 0001); its
-- tables reach outside it only to the shared kernel (employees) and the actors
-- (users). The files themselves are in the files store (internal/files), under
-- vault/<document>/<file><ext>.

-- Search: Postgres full-text search with accents folded (no Lithuanian stemmer
-- exists), and trigrams for near spellings. Both are trusted extensions in the
-- official image, so the database's owner creates them.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA vault;

-- unaccent() is only STABLE (its dictionary could change); this wrapper names
-- the dictionary, so expression indexes may use it.
CREATE FUNCTION vault.unaccent(TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
    SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$;

-- vault.ppe: simple (lower case, no stemming) with accents folded first, so
-- Žukauskaitė, zukauskaite and ŽUKAUSKAITĖ are one word.
CREATE TEXT SEARCH CONFIGURATION vault.ppe (COPY = pg_catalog.simple);
ALTER TEXT SEARCH CONFIGURATION vault.ppe
    ALTER MAPPING FOR hword, hword_part, word WITH public.unaccent, pg_catalog.simple;

-- A document: one paper of a type fixed in code (vault.Types()).
CREATE TABLE vault.documents (
    id                  UUID PRIMARY KEY,
    type                TEXT NOT NULL CHECK (type ~ '^[a-z][a-z_]*(\.[a-z_]+)*$' AND char_length(type) <= 60),
    -- The type's names in English, Lithuanian and Russian, for search (weight A).
    type_words          TEXT NOT NULL DEFAULT '' CHECK (char_length(type_words) <= 300),
    title               TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    number              TEXT CHECK (number <> '' AND char_length(number) <= 50),
    document_date       DATE,
    valid_from          DATE,
    valid_until         DATE,
    origin              TEXT NOT NULL CHECK (origin IN ('uploaded', 'generated', 'archived')),
    -- Where an archived or migrated document comes from: archiving it twice is
    -- impossible.
    source_kind         TEXT CHECK (source_kind ~ '^[a-z_]+$'),
    source_id           UUID,
    -- An annex's contract.
    parent_id           UUID REFERENCES vault.documents (id),
    sealed              BOOLEAN NOT NULL DEFAULT false,
    -- The permissions a reader needs, every one: the type's read permission and
    -- what its links require (an equipment item's equipment.read).
    requires            TEXT[] NOT NULL DEFAULT '{}',
    search              TSVECTOR NOT NULL DEFAULT ''::tsvector,
    created_at          TIMESTAMPTZ NOT NULL,
    created_by_user_id  UUID NOT NULL REFERENCES users (id),
    updated_at          TIMESTAMPTZ NOT NULL,
    updated_by_user_id  UUID NOT NULL REFERENCES users (id),
    deleted_at          TIMESTAMPTZ,
    deleted_by_user_id  UUID REFERENCES users (id),
    CHECK ((source_kind IS NULL) = (source_id IS NULL)),
    CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until),
    CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL)),
    UNIQUE (source_kind, source_id)
);

CREATE UNIQUE INDEX vault_documents_number_live_idx ON vault.documents (type, lower(number))
    WHERE number IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX vault_documents_live_idx ON vault.documents (created_at DESC, id) WHERE deleted_at IS NULL;
CREATE INDEX vault_documents_search_idx ON vault.documents USING GIN (search);
CREATE INDEX vault_documents_requires_idx ON vault.documents USING GIN (requires);
CREATE INDEX vault_documents_title_trgm_idx ON vault.documents USING GIN (vault.unaccent(lower(title)) gin_trgm_ops);

-- A version: one state of a document. Never changed or deleted.
CREATE TABLE vault.versions (
    id                  UUID PRIMARY KEY,
    document_id         UUID NOT NULL REFERENCES vault.documents (id),
    number              INTEGER NOT NULL CHECK (number >= 1),
    origin              TEXT NOT NULL CHECK (origin IN ('original', 'added', 'generated', 'signed', 'archived')),
    -- SHA-256: an upload's main file's; a generated or archived version's
    -- canonical values' or snapshot's.
    document_hash       TEXT NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
    note                TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
    created_at          TIMESTAMPTZ NOT NULL,
    created_by_user_id  UUID NOT NULL REFERENCES users (id),
    UNIQUE (document_id, number)
);

-- A file: the bytes a version holds, in the files store. Never changed or deleted.
CREATE TABLE vault.files (
    id                  UUID PRIMARY KEY,
    version_id          UUID NOT NULL REFERENCES vault.versions (id),
    role                TEXT NOT NULL CHECK (role IN ('main', 'source')),
    object_key          TEXT NOT NULL UNIQUE CHECK (char_length(object_key) BETWEEN 1 AND 300),
    file_name           TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
    content_type        TEXT NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    size_bytes          BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 104857600),
    -- Of the plain bytes, checked when the file is opened.
    sha256              TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    sealed              BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL,
    created_by_user_id  UUID NOT NULL REFERENCES users (id)
);

CREATE UNIQUE INDEX vault_files_main_idx ON vault.files (version_id) WHERE role = 'main';

-- A link: what a document is about. Only an employee is a foreign key (the
-- shared kernel); the others are checked by the API when linked. A locked link
-- was made by generation, archiving or a migration and is not the user's to
-- remove. label is the subject's name, refreshed by the API's upkeep.
CREATE TABLE vault.links (
    document_id         UUID NOT NULL REFERENCES vault.documents (id),
    subject_kind        TEXT NOT NULL CHECK (subject_kind IN ('employee', 'company', 'employment', 'asset', 'order', 'supplier')),
    subject_id          UUID NOT NULL,
    employee_id         UUID REFERENCES employees (id),
    label               TEXT NOT NULL DEFAULT '' CHECK (char_length(label) <= 300),
    requires            TEXT[] NOT NULL DEFAULT '{}',
    locked              BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL,
    created_by_user_id  UUID NOT NULL REFERENCES users (id),
    PRIMARY KEY (document_id, subject_kind, subject_id),
    CHECK ((subject_kind = 'employee') = (employee_id IS NOT NULL)),
    CHECK (employee_id IS NULL OR employee_id = subject_id)
);

CREATE INDEX vault_links_subject_idx ON vault.links (subject_kind, subject_id);

-- The text read from a version's file (the worker, phase 4). Rows start
-- pending; until the worker exists nothing reads them.
CREATE TABLE vault.version_text (
    version_id  UUID PRIMARY KEY REFERENCES vault.versions (id),
    state       TEXT NOT NULL CHECK (state IN ('pending', 'reading', 'read', 'none', 'failed', 'skipped')),
    method      TEXT CHECK (method IN ('pdf_text', 'ocr', 'blocks')),
    language    TEXT CHECK (char_length(language) <= 20),
    pages       INTEGER CHECK (pages >= 0),
    -- The text itself, only for types that are not sealed.
    content     TEXT CHECK (octet_length(content) <= 1048576),
    tsv         TSVECTOR,
    read_at     TIMESTAMPTZ,
    error       TEXT CHECK (error ~ '^[a-z_]{1,40}$')
);

CREATE INDEX vault_version_text_pending_idx ON vault.version_text (version_id) WHERE state = 'pending';

CREATE TRIGGER vault_versions_append_only BEFORE UPDATE OR DELETE ON vault.versions
    FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER vault_files_append_only BEFORE UPDATE OR DELETE ON vault.files
    FOR EACH ROW EXECUTE FUNCTION append_only();

-- refresh_search rebuilds a document's search vector from its title, number
-- and type's names (A), its links' labels (B), its files' names (C) and the
-- text read from its versions (D). The API calls it after every change to a
-- document, and Merge Employees after moving links.
CREATE FUNCTION vault.refresh_search(doc UUID) RETURNS VOID
LANGUAGE sql AS $$
    UPDATE vault.documents d SET search =
        setweight(to_tsvector('vault.ppe', d.title || ' ' || coalesce(d.number, '') || ' ' || d.type_words), 'A')
        || setweight(to_tsvector('vault.ppe', coalesce(
            (SELECT string_agg(l.label, ' ') FROM vault.links l WHERE l.document_id = d.id), '')), 'B')
        || setweight(to_tsvector('vault.ppe', coalesce(
            (SELECT string_agg(regexp_replace(f.file_name, '[._()-]+', ' ', 'g'), ' ')
             FROM vault.files f JOIN vault.versions v ON v.id = f.version_id
             WHERE v.document_id = d.id AND NOT f.sealed), '')), 'C')
        || setweight(array_to_tsvector(coalesce(
            (SELECT array_agg(DISTINCT w) FROM vault.versions v
             JOIN vault.version_text t ON t.version_id = v.id,
             LATERAL unnest(tsvector_to_array(t.tsv)) AS w
             WHERE v.document_id = d.id AND t.tsv IS NOT NULL), '{}')), 'D')
    WHERE d.id = doc
$$;

-- See and manage the vault: Administrator's and Manager's (role.AdminID, role.ManagerID).
INSERT INTO role_permissions (role_id, permission)
VALUES ('a0e1d000-0000-4000-8000-000000000001', 'vault.read'),
       ('a0e1d000-0000-4000-8000-000000000001', 'vault.manage'),
       ('a0e1d000-0000-4000-8000-000000000002', 'vault.read'),
       ('a0e1d000-0000-4000-8000-000000000002', 'vault.manage')
ON CONFLICT DO NOTHING;
