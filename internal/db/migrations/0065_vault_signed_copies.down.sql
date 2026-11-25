-- Back to asset_signed_copies: a copy uploaded into the vault since 0065 goes
-- back there (its object stays where it is), then the asset.signed_form
-- documents leave the vault. Versions and files are append-only, so their
-- triggers stand aside for this transaction's deletes.
INSERT INTO asset_signed_copies (id, assignment_id, object_key, file_name, content_type, size_bytes, sha256,
    uploaded_at, uploaded_by_user_id)
SELECT f.id, d.source_id, f.object_key, f.file_name, f.content_type, f.size_bytes, f.sha256, v.created_at, v.created_by_user_id
FROM vault.documents d
JOIN vault.versions v ON v.document_id = d.id
JOIN vault.files f ON f.version_id = v.id AND f.role = 'main'
WHERE d.type = 'asset.signed_form' AND d.source_kind = 'asset_signed_form'
ON CONFLICT (id) DO NOTHING;

CREATE TEMPORARY TABLE leaving ON COMMIT DROP AS
SELECT v.id AS version_id, d.id AS document_id
FROM vault.documents d JOIN vault.versions v ON v.document_id = d.id
WHERE d.type = 'asset.signed_form';

UPDATE outbox.jobs SET state = 'failed', last_error = 'removed: migration 0065 reverted', finished_at = now()
WHERE kind = 'vault.extract_text' AND state IN ('pending', 'running')
    AND key IN (SELECT version_id::text FROM leaving);

ALTER TABLE vault.versions DISABLE TRIGGER vault_versions_append_only;
ALTER TABLE vault.files DISABLE TRIGGER vault_files_append_only;
DELETE FROM vault.version_text WHERE version_id IN (SELECT version_id FROM leaving);
DELETE FROM vault.files WHERE version_id IN (SELECT version_id FROM leaving);
DELETE FROM vault.versions WHERE id IN (SELECT version_id FROM leaving);
ALTER TABLE vault.versions ENABLE TRIGGER vault_versions_append_only;
ALTER TABLE vault.files ENABLE TRIGGER vault_files_append_only;
DELETE FROM vault.links WHERE document_id IN (SELECT id FROM vault.documents WHERE type = 'asset.signed_form');
DELETE FROM vault.documents WHERE type = 'asset.signed_form';

DROP FUNCTION vault.move_signed_copies();
