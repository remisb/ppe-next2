-- Document Vault, phase 8 (ADR 0008 decision 6; docs/specs/document-template-service.md,
-- "DOCX templates"): a template version may be an uploaded Word document, its
-- placeholders filled on generation and the result converted to PDF by the
-- worker (LibreOffice). The DOCX a PDF was made from is kept beside it.

-- A version's kind; a DOCX version's file in the files store (its SHA-256 and
-- fields are in body, ppe.docx.v1, so body_sha256 covers them).
ALTER TABLE vault.template_versions
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'blocks' CHECK (kind IN ('blocks', 'docx')),
    ADD COLUMN docx_key TEXT CHECK (char_length(docx_key) BETWEEN 1 AND 300),
    ADD COLUMN docx_name TEXT CHECK (char_length(docx_name) BETWEEN 1 AND 200),
    ADD COLUMN docx_size BIGINT CHECK (docx_size BETWEEN 1 AND 5242880),
    ADD CONSTRAINT vault_template_versions_docx CHECK (
        (kind = 'docx') = (docx_key IS NOT NULL AND docx_name IS NOT NULL AND docx_size IS NOT NULL));

-- A generated version's source file may be the filled DOCX.
ALTER TABLE vault.files
    DROP CONSTRAINT files_content_type_check,
    ADD CONSTRAINT files_content_type_check CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));

-- A DOCX on its way to a PDF: the API fills it and the worker converts it
-- (vault.render_docx). Its files (vault/renders/<id>.docx and .pdf) are
-- sealed with a key of its own under API_VAULT_KEY; a document's render
-- holds the document to make, sealed, until its PDF is there. The upkeep
-- removes renders an hour old, with their files.
CREATE TABLE vault.renders (
    id                  UUID PRIMARY KEY,
    purpose             TEXT NOT NULL CHECK (purpose IN ('preview', 'document')),
    state               TEXT NOT NULL CHECK (state IN ('pending', 'done', 'failed', 'finished')),
    sealed_key          BYTEA NOT NULL CHECK (octet_length(sealed_key) BETWEEN 29 AND 100),
    key_id              SMALLINT NOT NULL CHECK (key_id >= 1),
    data_sealed         BYTEA CHECK (octet_length(data_sealed) <= 1048576),
    values_hash         TEXT CHECK (values_hash ~ '^[0-9a-f]{64}$'),
    document_id         UUID REFERENCES vault.documents (id),
    error               TEXT CHECK (error ~ '^[a-z_]{1,40}$'),
    created_at          TIMESTAMPTZ NOT NULL,
    created_by_user_id  UUID NOT NULL REFERENCES users (id),
    finished_at         TIMESTAMPTZ,
    CHECK ((purpose = 'document') = (data_sealed IS NOT NULL)),
    CHECK ((state = 'finished') = (document_id IS NOT NULL))
);
CREATE INDEX vault_renders_created_idx ON vault.renders (created_at);
