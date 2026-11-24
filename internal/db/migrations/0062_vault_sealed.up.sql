-- Document Vault, phase 2 (ADR 0008 decision 4, docs/specs/vault-service.md
-- "Sealed types"): Employment documents, sealed with a data key per document
-- under API_VAULT_KEY, kept by their type's retention rule, then shredded; a
-- Legal Hold stops that. The keys are never in the database: a dump holds
-- only ciphertext.

-- A sealed document's data key, sealed by the master keyring and bound to the
-- document. Deleting the row is the shredding: nothing of it opens again.
CREATE TABLE vault.document_keys (
    document_id  UUID PRIMARY KEY REFERENCES vault.documents (id),
    sealed_key   BYTEA NOT NULL CHECK (octet_length(sealed_key) BETWEEN 29 AND 100),
    key_id       SMALLINT NOT NULL CHECK (key_id >= 1),
    created_at   TIMESTAMPTZ NOT NULL
);

-- A sealed document's title is sealed (title_sealed) and its plain title
-- empty; retention, Legal Hold and the shredding's mark.
ALTER TABLE vault.documents DROP CONSTRAINT documents_title_check;
ALTER TABLE vault.documents
    ADD COLUMN title_sealed BYTEA,
    ADD COLUMN retain_until DATE,
    ADD COLUMN hold_until DATE,
    ADD COLUMN hold_reason TEXT CHECK (char_length(hold_reason) BETWEEN 1 AND 500),
    ADD COLUMN shredded_at TIMESTAMPTZ,
    ADD CONSTRAINT vault_documents_title_check CHECK (
        char_length(title) <= 200 AND (sealed OR char_length(title) >= 1)),
    ADD CONSTRAINT vault_documents_sealed_title CHECK (
        NOT sealed OR (title = '' AND (title_sealed IS NOT NULL OR shredded_at IS NOT NULL))),
    ADD CONSTRAINT vault_documents_hold_pair CHECK ((hold_until IS NULL) = (hold_reason IS NULL));

CREATE INDEX vault_documents_sealed_idx ON vault.documents (retain_until) WHERE sealed AND shredded_at IS NULL;

-- A sealed version's note and file name, sealed together (JSON).
ALTER TABLE vault.versions ADD COLUMN data_sealed BYTEA CHECK (octet_length(data_sealed) BETWEEN 29 AND 4000);

-- Versions and files are never changed or deleted, except by the shredding
-- (vault.shred_document), which says so for its own transaction.
CREATE FUNCTION vault.append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('ppe.vault_shred', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is append-only; only the shredding deletes rows', TG_TABLE_NAME;
END;
$$;
DROP TRIGGER vault_versions_append_only ON vault.versions;
DROP TRIGGER vault_files_append_only ON vault.files;
CREATE TRIGGER vault_versions_append_only BEFORE UPDATE OR DELETE ON vault.versions
    FOR EACH ROW EXECUTE FUNCTION vault.append_only();
CREATE TRIGGER vault_files_append_only BEFORE UPDATE OR DELETE ON vault.files
    FOR EACH ROW EXECUTE FUNCTION vault.append_only();

-- shred_document makes a sealed document unreadable for good: its key, its
-- versions, files, read text and links go, and its row stays as a tombstone
-- with its type, number and dates. It runs as the owner (SECURITY DEFINER),
-- so ppe_app needs no DELETE on versions and files, and refuses a document
-- that is not sealed, already shredded, or under a Legal Hold on day. It
-- returns the files' object keys, for the API to delete from the store.
CREATE FUNCTION vault.shred_document(doc UUID, at TIMESTAMPTZ, day DATE) RETURNS SETOF TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, public, pg_temp AS $$
DECLARE
    keys TEXT[];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM vault.documents d WHERE d.id = doc AND d.sealed AND d.shredded_at IS NULL
            AND (d.hold_until IS NULL OR d.hold_until < day)) THEN
        RAISE EXCEPTION 'document % is not sealed, is shredded already, or is held', doc;
    END IF;
    SELECT array_agg(f.object_key) INTO keys
        FROM vault.files f JOIN vault.versions v ON v.id = f.version_id WHERE v.document_id = doc;
    PERFORM set_config('ppe.vault_shred', 'on', true);
    DELETE FROM vault.document_keys WHERE document_id = doc;
    DELETE FROM vault.version_text t USING vault.versions v WHERE t.version_id = v.id AND v.document_id = doc;
    DELETE FROM vault.files f USING vault.versions v WHERE f.version_id = v.id AND v.document_id = doc;
    DELETE FROM vault.versions WHERE document_id = doc;
    DELETE FROM vault.links WHERE document_id = doc;
    UPDATE vault.documents SET title_sealed = NULL, search = ''::tsvector, shredded_at = at WHERE id = doc;
    PERFORM set_config('ppe.vault_shred', 'off', true);
    RETURN QUERY SELECT unnest(coalesce(keys, '{}'::TEXT[]));
END;
$$;

-- Employment Documents, a built-in add-on role (role.EmploymentID), the only
-- one holding the employment documents' permissions: no other role,
-- Administrator included, gets them (as Personnel Documents).
ALTER TABLE roles DROP CONSTRAINT roles_key_known;
ALTER TABLE roles ADD CONSTRAINT roles_key_known
    CHECK (key IS NULL OR key IN ('admin', 'manager', 'employee', 'equipment', 'testers', 'personnel', 'employment'));
INSERT INTO roles (id, key, name, description, created_at, updated_at) VALUES
    ('a0e1d000-0000-4000-8000-000000000007', 'employment', 'Employment Documents',
     'Sees and keeps employment contracts and other sealed employment documents.', now(), now());
INSERT INTO role_permissions (role_id, permission) VALUES
    ('a0e1d000-0000-4000-8000-000000000007', 'vault.employment.read'),
    ('a0e1d000-0000-4000-8000-000000000007', 'vault.employment.manage');
