DELETE FROM user_roles WHERE role_id = 'a0e1d000-0000-4000-8000-000000000007';
DELETE FROM role_permissions WHERE role_id = 'a0e1d000-0000-4000-8000-000000000007' OR permission LIKE 'vault.employment.%';
DELETE FROM roles WHERE id = 'a0e1d000-0000-4000-8000-000000000007';
ALTER TABLE roles DROP CONSTRAINT roles_key_known;
ALTER TABLE roles ADD CONSTRAINT roles_key_known
    CHECK (key IS NULL OR key IN ('admin', 'manager', 'employee', 'equipment', 'testers', 'personnel'));

DROP FUNCTION vault.shred_document(UUID, TIMESTAMPTZ, DATE);
DROP TRIGGER vault_versions_append_only ON vault.versions;
DROP TRIGGER vault_files_append_only ON vault.files;
CREATE TRIGGER vault_versions_append_only BEFORE UPDATE OR DELETE ON vault.versions
    FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER vault_files_append_only BEFORE UPDATE OR DELETE ON vault.files
    FOR EACH ROW EXECUTE FUNCTION append_only();
DROP FUNCTION vault.append_only();

-- Sealed documents cannot be kept without their columns: they go.
DELETE FROM vault.links l USING vault.documents d WHERE l.document_id = d.id AND d.sealed;
DELETE FROM vault.version_text t USING vault.versions v, vault.documents d WHERE t.version_id = v.id AND v.document_id = d.id AND d.sealed;
ALTER TABLE vault.versions DISABLE TRIGGER vault_versions_append_only;
ALTER TABLE vault.files DISABLE TRIGGER vault_files_append_only;
DELETE FROM vault.files f USING vault.versions v, vault.documents d WHERE f.version_id = v.id AND v.document_id = d.id AND d.sealed;
DELETE FROM vault.versions v USING vault.documents d WHERE v.document_id = d.id AND d.sealed;
ALTER TABLE vault.versions ENABLE TRIGGER vault_versions_append_only;
ALTER TABLE vault.files ENABLE TRIGGER vault_files_append_only;
DROP TABLE vault.document_keys;
DELETE FROM vault.documents WHERE sealed;
ALTER TABLE vault.versions DROP COLUMN data_sealed;
DROP INDEX vault.vault_documents_sealed_idx;
ALTER TABLE vault.documents
    DROP CONSTRAINT vault_documents_title_check,
    DROP CONSTRAINT vault_documents_sealed_title,
    DROP CONSTRAINT vault_documents_hold_pair,
    DROP COLUMN title_sealed, DROP COLUMN retain_until, DROP COLUMN hold_until, DROP COLUMN hold_reason, DROP COLUMN shredded_at;
ALTER TABLE vault.documents ADD CONSTRAINT documents_title_check CHECK (char_length(title) BETWEEN 1 AND 200);
